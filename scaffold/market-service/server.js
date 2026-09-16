// market-service
//
// Pretends to be the venues. It knows nothing whatsoever about the OMS: no
// securityId, no internal order id, no notion of a client. It is given a
// symbol, a venue, a currency, a side, a quantity and a price, and it trades.
//
//   GET    /health
//   POST   /orders                  place an order
//   DELETE /orders/:marketOrderId   ask for it to be cancelled
//   GET    /orders/:marketOrderId   what the market currently thinks (debug)
//
// Only the first of those answers immediately with an outcome. Everything the
// market decides afterwards - accepted, traded, rejected, cancelled - is
// published to the market-updates queue, out of order, sometimes twice.

import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Queue } from '../queue/index.js';
import { buildPlan } from './planner.js';
import { streamFor, intBetween, hashString } from '../lib/rng.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const SEED = process.env.MARKET_SEED ?? 'default-seed';
const DB_FILE = process.env.MARKET_DB ?? resolve(root, 'out/market.sqlite');
const QUEUE_FILE = process.env.QUEUE_FILE ?? resolve(root, 'out/queue.sqlite');
const QUEUE_NAME = process.env.QUEUE_NAME ?? 'market-updates';
const DUPLICATE_RATE = Number(process.env.QUEUE_DUPLICATE_RATE ?? 0);
const VENUES = new Set(['NYSE', 'NASDAQ', 'TSX']);

mkdirSync(dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec(`
CREATE TABLE IF NOT EXISTS market_order (
  market_order_id   TEXT PRIMARY KEY,
  client_order_id   TEXT NOT NULL UNIQUE,
  symbol            TEXT NOT NULL,
  venue             TEXT NOT NULL,
  currency          TEXT NOT NULL,
  side              TEXT NOT NULL,
  quantity          INTEGER NOT NULL,
  order_type        TEXT NOT NULL,
  limit_price_minor INTEGER,
  accepted_at       INTEGER NOT NULL,
  plan_kind         TEXT NOT NULL,
  state             TEXT NOT NULL,
  published_events  INTEGER NOT NULL DEFAULT 0,
  cancel_pending    INTEGER NOT NULL DEFAULT 0,
  cancel_answered   INTEGER NOT NULL DEFAULT 0,
  seq               INTEGER NOT NULL DEFAULT 0
);
`);

const queue = new Queue({
  file: QUEUE_FILE,
  name: QUEUE_NAME,
  duplicateRate: DUPLICATE_RATE,
});

const timers = new Map(); // marketOrderId -> [timeout, ...]

/**
 * The venue's own id for an order.
 *
 * Deliberately not a counter, and deliberately nothing to do with any id the
 * OMS holds. A real venue has never heard of your primary keys, and an id that
 * happened to line up with them would teach the wrong lesson. It is derived
 * from the clientOrderId so that it is still reproducible.
 */
function newMarketOrderId(clientOrderId) {
  const base = hashString(`${SEED}::market-order::${clientOrderId}`).toString(36);
  let candidate = `MKT-${base}`;
  let attempt = 0;
  while (loadOrder(candidate)) {
    attempt += 1;
    candidate = `MKT-${base}${attempt}`;
  }
  return candidate;
}

function loadOrder(marketOrderId) {
  return db.prepare('SELECT * FROM market_order WHERE market_order_id = ?').get(marketOrderId);
}

function publish(order, message) {
  const seq = order.seq + 1;
  db.prepare('UPDATE market_order SET seq = ? WHERE market_order_id = ?').run(
    seq,
    order.market_order_id
  );
  order.seq = seq;
  const messageId = `MSG-${order.market_order_id}-${seq}`;
  queue.publish(messageId, {
    messageId,
    sequence: seq,
    marketOrderId: order.market_order_id,
    clientOrderId: order.client_order_id,
    occurredAt: new Date().toISOString(),
    ...message,
  });
  console.log(`[market-service] published ${message.type} for ${order.market_order_id}`);
}

function setState(marketOrderId, state) {
  db.prepare('UPDATE market_order SET state = ? WHERE market_order_id = ?').run(
    state,
    marketOrderId
  );
}

function toPlanOrder(row) {
  return {
    clientOrderId: row.client_order_id,
    symbol: row.symbol,
    venue: row.venue,
    quantity: row.quantity,
    orderType: row.order_type,
    limitPriceMinor: row.limit_price_minor,
  };
}

/** Schedule every plan event that has not been published yet. */
function schedulePlan(row) {
  const plan = buildPlan(SEED, toPlanOrder(row));
  const handles = [];

  plan.events.forEach((event, index) => {
    if (index < row.published_events) return;
    const dueAt = row.accepted_at + event.atMs;
    const delay = Math.max(0, dueAt - Date.now());

    handles.push(
      setTimeout(() => {
        const current = loadOrder(row.market_order_id);
        if (!current || current.state !== 'OPEN') return;

        if (event.type === 'ACCEPTED') {
          publish(current, { type: 'ACCEPTED' });
        } else if (event.type === 'REJECTED') {
          publish(current, { type: 'REJECTED', reason: event.reason });
          setState(current.market_order_id, 'REJECTED');
        } else if (event.type === 'FILL') {
          publish(current, {
            type: 'FILL',
            execId: `EXEC-${current.market_order_id}-${current.seq + 1}`,
            lastQuantity: event.quantity,
            lastPriceMinor: event.priceMinor,
          });
          if (index === plan.events.length - 1 && !plan.restsForever) {
            setState(current.market_order_id, 'FILLED');
          }
        }

        db.prepare('UPDATE market_order SET published_events = ? WHERE market_order_id = ?').run(
          index + 1,
          row.market_order_id
        );
      }, delay)
    );
  });

  timers.set(row.market_order_id, handles);
}

// Anything still open when the process starts gets its remaining plan events
// scheduled again, so the market survives a restart too.
for (const row of db.prepare("SELECT * FROM market_order WHERE state = 'OPEN'").all()) {
  schedulePlan(row);
}

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ service: 'market-service', status: 'UP', seed: SEED });
});

app.post('/orders', (req, res) => {
  const body = req.body ?? {};
  const required = [
    'clientOrderId',
    'symbol',
    'venue',
    'currency',
    'side',
    'quantity',
    'orderType',
  ];
  for (const field of required) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      return res.status(400).json({ error: 'MISSING_FIELD', field });
    }
  }
  if (!VENUES.has(body.venue)) {
    return res.status(400).json({ error: 'UNKNOWN_VENUE', field: 'venue' });
  }
  if (!['BUY', 'SELL'].includes(body.side)) {
    return res.status(400).json({ error: 'INVALID_SIDE', field: 'side' });
  }
  if (!['MARKET', 'LIMIT'].includes(body.orderType)) {
    return res.status(400).json({ error: 'INVALID_ORDER_TYPE', field: 'orderType' });
  }
  if (!Number.isInteger(body.quantity) || body.quantity <= 0) {
    return res.status(400).json({ error: 'INVALID_QUANTITY', field: 'quantity' });
  }
  if (body.orderType === 'LIMIT' && !Number.isInteger(body.limitPriceMinor)) {
    return res.status(400).json({ error: 'MISSING_LIMIT_PRICE', field: 'limitPriceMinor' });
  }

  // Placing the same clientOrderId twice does not create a second order.
  const existing = db
    .prepare('SELECT * FROM market_order WHERE client_order_id = ?')
    .get(body.clientOrderId);
  if (existing) {
    return res.status(200).json({
      marketOrderId: existing.market_order_id,
      clientOrderId: existing.client_order_id,
      duplicate: true,
    });
  }

  const marketOrderId = newMarketOrderId(body.clientOrderId);
  const acceptedAt = Date.now();
  const plan = buildPlan(SEED, {
    clientOrderId: body.clientOrderId,
    symbol: body.symbol,
    venue: body.venue,
    quantity: body.quantity,
    orderType: body.orderType,
    limitPriceMinor: body.limitPriceMinor ?? null,
  });

  db.prepare(
    `INSERT INTO market_order
       (market_order_id, client_order_id, symbol, venue, currency, side, quantity,
        order_type, limit_price_minor, accepted_at, plan_kind, state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')`
  ).run(
    marketOrderId,
    body.clientOrderId,
    body.symbol,
    body.venue,
    body.currency,
    body.side,
    body.quantity,
    body.orderType,
    body.limitPriceMinor ?? null,
    acceptedAt,
    plan.kind
  );

  schedulePlan(loadOrder(marketOrderId));
  res.status(201).json({ marketOrderId, clientOrderId: body.clientOrderId, duplicate: false });
});

// Cancelling is a request, not a command. The venue answers on the queue, and
// it answers only once it has finished doing whatever it was already doing with
// the order - so an order that was on its way to trading trades anyway, and the
// cancel comes back refused.
app.delete('/orders/:marketOrderId', (req, res) => {
  const order = loadOrder(req.params.marketOrderId);
  if (!order) {
    return res.status(404).json({ error: 'ORDER_NOT_FOUND' });
  }

  const rng = streamFor(SEED, `${order.client_order_id}::cancel`);
  const delay = intBetween(rng, 30, 120);

  if (order.cancel_pending) {
    setTimeout(() => {
      publish(loadOrder(order.market_order_id), {
        type: 'CANCEL_REJECTED',
        reason: 'CANCEL_ALREADY_PENDING',
      });
    }, delay);
    return res
      .status(202)
      .json({ marketOrderId: order.market_order_id, status: 'CANCEL_PENDING' });
  }

  db.prepare('UPDATE market_order SET cancel_pending = 1 WHERE market_order_id = ?').run(
    order.market_order_id
  );

  // Wait until everything the venue had already planned for this order has
  // happened, then decide. That makes the answer depend on the order itself
  // rather than on how quickly the cancel happened to arrive.
  const plan = buildPlan(SEED, toPlanOrder(order));
  const planEndsAt = order.accepted_at + Math.max(...plan.events.map((e) => e.atMs));
  const fireAt = Math.max(Date.now(), planEndsAt) + delay;

  setTimeout(() => {
    const current = loadOrder(order.market_order_id);
    if (current.state === 'OPEN') {
      publish(current, { type: 'CANCELLED' });
      setState(current.market_order_id, 'CANCELLED');
    } else {
      publish(current, {
        type: 'CANCEL_REJECTED',
        reason: `ALREADY_${current.state}`,
      });
    }
    db.prepare('UPDATE market_order SET cancel_answered = 1 WHERE market_order_id = ?').run(
      current.market_order_id
    );
  }, Math.max(0, fireAt - Date.now()));

  res.status(202).json({ marketOrderId: order.market_order_id, status: 'CANCEL_PENDING' });
});

// Has the venue finished everything it was going to do? The tests use this to
// know when it is fair to look at the answers.
app.get('/quiet', (req, res) => {
  const busy = db
    .prepare('SELECT * FROM market_order')
    .all()
    .filter((row) => {
      const plan = buildPlan(SEED, toPlanOrder(row));
      if (row.state === 'OPEN' && row.published_events < plan.events.length) return true;
      if (row.cancel_pending === 1 && row.cancel_answered === 0) return true;
      return false;
    })
    .map((row) => row.market_order_id);

  res.json({ quiet: busy.length === 0, busy, queueDepth: queue.pendingCount() });
});

app.get('/orders/:marketOrderId', (req, res) => {
  const order = loadOrder(req.params.marketOrderId);
  if (!order) return res.status(404).json({ error: 'ORDER_NOT_FOUND' });
  res.json(order);
});

const port = Number(process.env.MARKET_PORT ?? 4002);
app.listen(port, () => {
  console.log(
    `[market-service] listening on ${port}, seed=${SEED}, duplicateRate=${DUPLICATE_RATE}`
  );
});
