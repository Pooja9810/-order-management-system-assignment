// Acceptance tests.
//
// These start your services as separate processes and talk to them over HTTP.
// They never import your code, so how you organise it is entirely up to you.
// The only fixed points are the three entry files and the four ports.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  ROOT,
  URLS,
  loadScenario,
  resetOutputs,
  startSystem,
  runDriver,
  settle,
  getJson,
  postJson,
  deleteJson,
  normalize,
  readReport,
  readExpected,
  requireStudentCode,
  sleep,
} from './helpers/harness.js';

function scenarioPath(fixture) {
  return join(ROOT, 'data', 'scenarios', `${fixture}.json`);
}

function placedOrderCount(scenario) {
  return scenario.actions.filter((a) => a.action === 'place' && a.ref.startsWith('o')).length;
}

/**
 * Ask for a report, once, the first time a test actually needs one.
 *
 * Deliberately lazy: until the report is written, only the tests that look at
 * the report fail. Everything earned before that still passes.
 */
function reportOnce() {
  let pending = null;
  return () => (pending ??= postJson(`${URLS.ledger}/generate-report`));
}

/**
 * The status §10.1 says an order must be in, worked out from the rest of the
 * same response. A status kept in a column and maintained by hand drifts away
 * from this; one worked out from the executions cannot.
 */
function derivedStatus(o) {
  if (o.rejectReason !== null) return 'REJECTED';
  if (o.filledQuantity >= o.quantity) return 'FILLED';
  if (o.cancelOutcome === 'CANCELLED') return 'CANCELLED';
  if (o.cancelRequested && o.cancelOutcome === null) return 'PENDING_CANCEL';
  if (o.filledQuantity > 0) return 'PARTIALLY_FILLED';
  if (o.marketOrderId !== null) return 'WORKING';
  return 'NEW';
}

/** Boot, drive, restart if the fixture asks for it, settle. */
async function runFixture(fixture) {
  const scenario = loadScenario(fixture);
  resetOutputs();
  const system = await startSystem(scenario);

  try {
    const driver = await runDriver(scenarioPath(fixture));
    assert.equal(driver.code, 0, `the driver exited with ${driver.code}:\n${driver.output}`);

    if (scenario.restartAfterDriverMs) {
      await sleep(scenario.restartAfterDriverMs);
      await system.restartOrderService('SIGKILL');
    }

    const orders = await settle({ expectedOrders: placedOrderCount(scenario) });
    return { scenario, system, orders };
  } catch (err) {
    await system.stop();
    throw err;
  }
}

test('the three entry points exist', () => {
  requireStudentCode();
});

test('warmup: five orders, nothing awkward', { timeout: 120000 }, async (t) => {
  requireStudentCode();
  const { scenario, system, orders } = await runFixture('warmup');

  try {
    await t.test('order ids run 1..N with no gaps', () => {
      const ids = orders.map((o) => o.orderId);
      assert.deepEqual(
        ids,
        ids.map((_, i) => i + 1),
        'order ids must be whole numbers counting up from 1, and a request that ' +
          'was refused must not use one up. Got: ' + ids.join(', ')
      );
      assert.equal(ids.length, placedOrderCount(scenario));
    });

    await t.test('every order matches expected/warmup/orders.json', () => {
      assert.deepEqual(
        normalize({ orders }),
        JSON.parse(readExpected('warmup', 'orders.json'))
      );
    });

    const report = reportOnce();

    await t.test('the ledger holds what expected/warmup/ledger.json says', async () => {
      const ledger = await getJson(`${URLS.ledger}/posted-orders`);
      assert.deepEqual(normalize(ledger.body), JSON.parse(readExpected('warmup', 'ledger.json')));
    });

    await t.test('the inventory report matches', async () => {
      const { body } = await report();
      assert.equal(readReport(`inventory-${body.reportId}.csv`), readExpected('warmup', 'inventory.csv'));
    });

    await t.test('the venue report matches', async () => {
      const { body } = await report();
      assert.equal(readReport(`venues-${body.reportId}.csv`), readExpected('warmup', 'venues.csv'));
    });

    // Refusals are checked against a settled system so the order count is stable.
    const refusals = [
      ['side is not BUY or SELL', { clientOrderId: 'refused-1', securityId: 'SEC-1001', side: 'HOLD', quantity: 10, orderType: 'MARKET' }, 400, 'INVALID_SIDE'],
      ['order type is not MARKET or LIMIT', { clientOrderId: 'refused-2', securityId: 'SEC-1001', side: 'BUY', quantity: 10, orderType: 'STOP' }, 400, 'INVALID_ORDER_TYPE'],
      ['quantity is zero', { clientOrderId: 'refused-3', securityId: 'SEC-1001', side: 'BUY', quantity: 0, orderType: 'MARKET' }, 400, 'INVALID_QUANTITY'],
      ['quantity is not a whole number', { clientOrderId: 'refused-4', securityId: 'SEC-1001', side: 'BUY', quantity: 1.5, orderType: 'MARKET' }, 400, 'INVALID_QUANTITY'],
      ['a limit order with no price', { clientOrderId: 'refused-5', securityId: 'SEC-1001', side: 'BUY', quantity: 10, orderType: 'LIMIT' }, 400, 'MISSING_LIMIT_PRICE'],
      ['a market order with a price', { clientOrderId: 'refused-6', securityId: 'SEC-1001', side: 'BUY', quantity: 10, orderType: 'MARKET', limitPriceMinor: 100 }, 400, 'UNEXPECTED_LIMIT_PRICE'],
      ['neither a securityId nor a symbol', { clientOrderId: 'tm', side: 'BUY', quantity: 10, orderType: 'MARKET' }, 400, 'MISSING_SECURITY'],
      ['no clientOrderId at all', { securityId: 'SEC-1001', side: 'BUY', quantity: 10, orderType: 'MARKET' }, 400, 'MISSING_CLIENT_ORDER_ID'],
      ['an empty clientOrderId', { clientOrderId: '   ', securityId: 'SEC-1001', side: 'BUY', quantity: 10, orderType: 'MARKET' }, 400, 'MISSING_CLIENT_ORDER_ID'],
      ['a securityId and a symbol together', { clientOrderId: 'refused-7', securityId: 'SEC-1001', symbol: 'AAPL', side: 'BUY', quantity: 10, orderType: 'MARKET' }, 400, 'AMBIGUOUS_SECURITY'],
      ['a securityId with a venue', { clientOrderId: 'refused-8', securityId: 'SEC-1001', venue: 'NASDAQ', side: 'BUY', quantity: 10, orderType: 'MARKET' }, 400, 'UNEXPECTED_VENUE'],
      ['a securityId nobody has heard of', { clientOrderId: 'refused-9', securityId: 'SEC-9999', side: 'BUY', quantity: 10, orderType: 'MARKET' }, 404, 'UNKNOWN_SECURITY'],
      ['a symbol nothing trades under', { clientOrderId: 'refused-10', symbol: 'WIDG', side: 'BUY', quantity: 10, orderType: 'MARKET' }, 404, 'UNKNOWN_SYMBOL'],
      ['a symbol that is not listed at that venue', { clientOrderId: 'refused-11', symbol: 'AAPL', venue: 'TSX', side: 'BUY', quantity: 10, orderType: 'MARKET' }, 404, 'SYMBOL_NOT_AT_VENUE'],
      ['a symbol listed on two venues, with no venue given', { clientOrderId: 'refused-12', symbol: 'SHOP', side: 'BUY', quantity: 10, orderType: 'MARKET' }, 422, 'AMBIGUOUS_SYMBOL'],
      ['a security that is halted', { clientOrderId: 'refused-13', securityId: 'SEC-1008', side: 'BUY', quantity: 10, orderType: 'MARKET' }, 422, 'SECURITY_NOT_TRADABLE'],
      ['a quantity that is not whole lots', { clientOrderId: 'refused-14', securityId: 'SEC-1006', side: 'BUY', quantity: 150, orderType: 'LIMIT', limitPriceMinor: 5900 }, 422, 'INVALID_LOT_SIZE'],
      ['a price that is not on a tick', { clientOrderId: 'refused-15', securityId: 'SEC-1007', side: 'BUY', quantity: 5, orderType: 'LIMIT', limitPriceMinor: 1234 }, 422, 'INVALID_PRICE_TICK'],
    ];

    for (const [description, body, status, error] of refusals) {
      await t.test(`refused: ${description}`, async () => {
        const response = await postJson(`${URLS.order}/orders`, body);
        assert.equal(response.status, status, `body was ${JSON.stringify(body)}`);
        assert.equal(response.body.error, error);
      });
    }

    await t.test('none of those refusals created an order', async () => {
      const { body } = await getJson(`${URLS.order}/orders`);
      assert.equal(
        body.orders.length,
        placedOrderCount(scenario),
        'a refused request must not create an order or use up an order id'
      );
    });

    // The caller's key is what makes a retry safe. Sending the same one again
    // must return the order that already exists, not make a second one.
    await t.test('the same clientOrderId twice makes one order, not two', async () => {
      const body = {
        clientOrderId: 'retry-me-once',
        securityId: 'SEC-1002',
        side: 'BUY',
        quantity: 5,
        orderType: 'MARKET',
      };
      const first = await postJson(`${URLS.order}/orders`, body);
      assert.equal(first.status, 201, 'the first time is a new order');

      const again = await postJson(`${URLS.order}/orders`, body);
      assert.equal(again.status, 200, 'the second time is not a new order');
      assert.equal(again.body.orderId, first.body.orderId, 'it is the same order');

      const all = await getJson(`${URLS.order}/orders`);
      const matching = all.body.orders.filter((o) => o.clientOrderId === 'retry-me-once');
      assert.equal(matching.length, 1, 'exactly one order should carry that key');
    });

    await t.test('a retry with a different body returns the original, unchanged', async () => {
      const key = 'retry-with-a-twist';
      const first = await postJson(`${URLS.order}/orders`, {
        clientOrderId: key, securityId: 'SEC-1002', side: 'BUY', quantity: 7, orderType: 'MARKET',
      });
      assert.equal(first.status, 201);

      // Same key, completely different order. The key wins: the answer to this
      // request was settled the first time it was asked.
      const again = await postJson(`${URLS.order}/orders`, {
        clientOrderId: key, securityId: 'SEC-1001', side: 'SELL', quantity: 999, orderType: 'MARKET',
      });
      assert.equal(again.status, 200);
      assert.equal(again.body.orderId, first.body.orderId);
      assert.equal(again.body.securityId, 'SEC-1002', 'the original security, not the retry body');
      assert.equal(again.body.side, 'BUY', 'the original side');
      assert.equal(again.body.quantity, 7, 'the original quantity');
    });

    await t.test('a symbol that is listed once resolves without a venue', async () => {
      const before = await getJson(`${URLS.order}/orders`);
      const response = await postJson(`${URLS.order}/orders`, {
        clientOrderId: 'probe-ry',
        symbol: 'RY',
        side: 'BUY',
        quantity: 1,
        orderType: 'MARKET',
      });
      assert.equal(response.status, 201, 'RY is listed only on TSX, so the symbol is enough');
      assert.equal(response.body.securityId, 'SEC-1005');
      assert.equal(response.body.venue, 'TSX');
      assert.equal(
        response.body.orderId,
        before.body.orders.length + 1,
        'an accepted order does take the next id'
      );
    });

    await t.test('a symbol on two venues resolves once the venue is given', async () => {
      const toronto = await postJson(`${URLS.order}/orders`, {
        clientOrderId: 'probe-shop-tsx',
        symbol: 'SHOP',
        venue: 'TSX',
        side: 'BUY',
        quantity: 1,
        orderType: 'MARKET',
      });
      const newYork = await postJson(`${URLS.order}/orders`, {
        clientOrderId: 'probe-shop-nyse',
        symbol: 'SHOP',
        venue: 'NYSE',
        side: 'BUY',
        quantity: 1,
        orderType: 'MARKET',
      });
      assert.equal(toronto.status, 201);
      assert.equal(newYork.status, 201);
      assert.equal(toronto.body.securityId, 'SEC-1003');
      assert.equal(newYork.body.securityId, 'SEC-1004');
      assert.notEqual(
        toronto.body.securityId,
        newYork.body.securityId,
        'the same symbol at two venues is two different securities'
      );
      assert.equal(toronto.body.currency, 'CAD');
      assert.equal(newYork.body.currency, 'USD');
    });

    // The status is a worked-out answer. Whether or not it is also kept in a
    // column, it has to agree with the facts the same response reports.
    await t.test('every order\'s status agrees with its own executions', () => {
      for (const o of orders) {
        assert.equal(
          o.status,
          derivedStatus(o),
          `order ${o.orderId} reports ${o.status}, but ${o.filledQuantity} of ${o.quantity} traded, ` +
            `rejectReason ${o.rejectReason}, cancelOutcome ${o.cancelOutcome}`
        );
      }
    });

    await t.test('filtering by status returns exactly the orders in it', async () => {
      const { body } = await getJson(`${URLS.order}/orders`);
      const statuses = new Set(body.orders.map((o) => o.status));
      for (const status of statuses) {
        const filtered = await getJson(`${URLS.order}/orders?status=${status}`);
        assert.equal(filtered.status, 200);
        assert.deepEqual(
          filtered.body.orders.map((o) => o.orderId),
          body.orders.filter((o) => o.status === status).map((o) => o.orderId),
          `?status=${status} did not return the orders that are in that status`
        );
      }
    });

    await t.test('filtering by a status that does not exist is refused', async () => {
      const response = await getJson(`${URLS.order}/orders?status=BANANA`);
      assert.equal(response.status, 400);
      assert.equal(response.body.error, 'INVALID_STATUS');
    });

    await t.test('a body that is not JSON is refused as JSON', async () => {
      const response = await fetch(`${URLS.order}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{ this is not json',
      });
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.error, 'MALFORMED_JSON');
    });

    await t.test('a route that does not exist answers 404 as JSON', async () => {
      const response = await getJson(`${URLS.order}/nonsense`);
      assert.equal(response.status, 404);
      assert.equal(response.body.error, 'NOT_FOUND');
    });

    await t.test('cancelling an order that does not exist is refused', async () => {
      const response = await deleteJson(`${URLS.order}/orders/9999`);
      assert.equal(response.status, 404);
      assert.equal(response.body.error, 'ORDER_NOT_FOUND');
    });

    await t.test('cancelling an order that has finished is refused', async () => {
      const response = await deleteJson(`${URLS.order}/orders/1`);
      assert.equal(response.status, 409);
      assert.equal(response.body.error, 'ORDER_NOT_ACTIVE');
    });
  } finally {
    await system.stop();
  }
});

test('main: cancels, duplicates and a restart', { timeout: 180000 }, async (t) => {
  requireStudentCode();
  const { scenario, system, orders } = await runFixture('main');

  try {
    await t.test('order ids run 1..N with no gaps', () => {
      const ids = orders.map((o) => o.orderId);
      assert.deepEqual(
        ids,
        ids.map((_, i) => i + 1),
        'thirteen of the requests in this scenario are refused. None of them is ' +
          'an order, and none of them uses up an order id. Got: ' + ids.join(', ')
      );
    });

    await t.test('every order matches expected/main/orders.json', () => {
      assert.deepEqual(normalize({ orders }), JSON.parse(readExpected('main', 'orders.json')));
    });

    await t.test('an order that was cancelled before trading is not in the ledger', () => {
      const untraded = orders.filter((o) => o.status === 'CANCELLED' && o.filledQuantity === 0);
      assert.ok(untraded.length > 0, 'this scenario has at least one of these');
      for (const order of untraded) {
        assert.equal(order.postedToLedger, false, `order ${order.orderId} never traded`);
      }
    });

    await t.test('an order that was cancelled after trading is in the ledger', () => {
      const partly = orders.filter((o) => o.status === 'CANCELLED' && o.filledQuantity > 0);
      assert.ok(partly.length > 0, 'this scenario has at least one of these');
      for (const order of partly) {
        assert.equal(order.postedToLedger, true, `order ${order.orderId} did trade`);
      }
    });

    await t.test('a cancel the venue refused leaves the order traded', () => {
      const refused = orders.filter((o) => o.cancelOutcome === 'REJECTED');
      assert.ok(refused.length > 0, 'this scenario has at least one of these');
      for (const order of refused) {
        assert.equal(order.cancelRequested, true);
        assert.equal(order.status, 'FILLED', 'asking to cancel does not stop an order trading');
        assert.equal(order.postedToLedger, true);
      }
    });

    await t.test('the same symbol on two venues stays two securities', () => {
      const shop = orders.filter((o) => o.symbol === 'SHOP');
      const ids = new Set(shop.map((o) => o.securityId));
      assert.equal(ids.size, 2, 'SHOP is listed on TSX and on NYSE and they are not the same thing');
    });

    const report = reportOnce();

    await t.test('each SHOP listing is its own line in the inventory report', async () => {
      const { body } = await report();
      const inventory = readReport(`inventory-${body.reportId}.csv`);
      assert.match(inventory, /SEC-1003,SHOP,STOCK,TSX,CAD/);
      assert.match(inventory, /SEC-1004,SHOP,STOCK,NYSE,USD/);
    });

    await t.test('the ledger holds what expected/main/ledger.json says', async () => {
      const ledger = await getJson(`${URLS.ledger}/posted-orders`);
      assert.deepEqual(normalize(ledger.body), JSON.parse(readExpected('main', 'ledger.json')));
    });

    await t.test('the inventory report matches', async () => {
      const { body } = await report();
      assert.equal(readReport(`inventory-${body.reportId}.csv`), readExpected('main', 'inventory.csv'));
    });

    await t.test('the venue report matches', async () => {
      const { body } = await report();
      assert.equal(readReport(`venues-${body.reportId}.csv`), readExpected('main', 'venues.csv'));
    });

    await t.test('posting an order the ledger already has is refused, and changes nothing', async () => {
      const before = await getJson(`${URLS.ledger}/posted-orders`);
      const existing = before.body.postedOrders[0];
      assert.ok(existing, 'the ledger should have something in it by now');

      const tampered = {
        orderId: existing.orderId,
        securityId: existing.securityId,
        symbol: existing.symbol,
        venue: existing.venue,
        currency: existing.currency,
        assetType: existing.assetType,
        contractMultiplier: existing.contractMultiplier,
        side: existing.side === 'BUY' ? 'SELL' : 'BUY',
        finalStatus: 'FILLED',
        executions: [
          { execId: 'EXEC-TAMPERED-1', executedQuantity: 999999, priceMinor: 1, occurredAt: new Date().toISOString() },
        ],
      };

      const response = await postJson(`${URLS.ledger}/post-order`, tampered);
      assert.equal(response.status, 409, 'an order that is already in the ledger cannot be written again');
      assert.equal(response.body.error, 'ORDER_ALREADY_POSTED');

      const after = await getJson(`${URLS.ledger}/posted-orders`);
      assert.deepEqual(after.body, before.body, 'the refused post must not have changed anything');
    });

    await t.test('the ledger refuses a post with no orderId', async () => {
      const response = await postJson(`${URLS.ledger}/post-order`, {
        orderId: 'seven',
        securityId: 'SEC-1001', symbol: 'AAPL', venue: 'NASDAQ', currency: 'USD',
        assetType: 'STOCK', contractMultiplier: 1, side: 'BUY', finalStatus: 'FILLED',
        executions: [{ execId: 'EXEC-X-1', executedQuantity: 1, priceMinor: 1, occurredAt: new Date().toISOString() }],
      });
      assert.equal(response.status, 400);
      assert.equal(response.body.error, 'INVALID_ORDER_ID');
    });

    await t.test('the ledger refuses a post that is missing a field', async () => {
      const response = await postJson(`${URLS.ledger}/post-order`, {
        orderId: 999998,
        securityId: 'SEC-1001', venue: 'NASDAQ', currency: 'USD',
        assetType: 'STOCK', contractMultiplier: 1, side: 'BUY', finalStatus: 'FILLED',
        executions: [{ execId: 'EXEC-X-2', executedQuantity: 1, priceMinor: 1, occurredAt: new Date().toISOString() }],
      });
      assert.equal(response.status, 400);
      assert.equal(response.body.error, 'MISSING_FIELD');
    });

    await t.test('the ledger refuses a post with a nonsense multiplier', async () => {
      const response = await postJson(`${URLS.ledger}/post-order`, {
        orderId: 999997,
        securityId: 'SEC-1001', symbol: 'AAPL', venue: 'NASDAQ', currency: 'USD',
        assetType: 'STOCK', contractMultiplier: 0, side: 'BUY', finalStatus: 'FILLED',
        executions: [{ execId: 'EXEC-X-3', executedQuantity: 1, priceMinor: 1, occurredAt: new Date().toISOString() }],
      });
      assert.equal(response.status, 400);
      assert.equal(response.body.error, 'INVALID_CONTRACT_MULTIPLIER');
    });

    await t.test('the ledger refuses a body that is not JSON', async () => {
      const response = await fetch(`${URLS.ledger}/post-order`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json at all',
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, 'MALFORMED_JSON');
    });

    await t.test('none of those refused posts reached the ledger', async () => {
      const { body } = await getJson(`${URLS.ledger}/posted-orders`);
      const ids = body.postedOrders.map((p) => p.orderId);
      for (const id of [999997, 999998]) {
        assert.ok(!ids.includes(id), `order ${id} was refused and must not be in the ledger`);
      }
    });

    await t.test('an order with no trades is not something the ledger accepts', async () => {
      const response = await postJson(`${URLS.ledger}/post-order`, {
        orderId: 999999,
        securityId: 'SEC-1001',
        symbol: 'AAPL',
        venue: 'NASDAQ',
        currency: 'USD',
        assetType: 'STOCK',
        contractMultiplier: 1,
        side: 'BUY',
        finalStatus: 'CANCELLED',
        executions: [],
      });
      assert.equal(response.status, 400);
      assert.equal(response.body.error, 'NO_EXECUTIONS');
    });

    await t.test('generating the report again numbers it and says the same thing', async () => {
      const first = await report();
      const again = await postJson(`${URLS.ledger}/generate-report`);
      assert.equal(again.body.reportId, first.body.reportId + 1);
      assert.equal(
        readReport(`inventory-${again.body.reportId}.csv`),
        readReport(`inventory-${first.body.reportId}.csv`),
        'nothing traded in between, so the numbers cannot have moved'
      );
    });
  } finally {
    await system.stop();
  }
});
