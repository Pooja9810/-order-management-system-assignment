// A small message queue backed by a SQLite file.
//
// It is deliberately not clever, but it behaves like the real thing in the four
// ways that matter to the program consuming it:
//
//   1. It is persisted. Stop every process, start them again, and the messages
//      that were not acknowledged are still there.
//   2. Delivery is UNORDERED. Messages come out in whatever order the queue
//      feels like, which is not the order they went in.
//   3. Delivery is AT LEAST ONCE. A message can be handed to you more than
//      once: because the publisher wrote it twice, or because you took it and
//      did not acknowledge it before the visibility timeout expired.
//   4. A message you take is hidden from other readers for a while, and comes
//      back if you never acknowledge it.
//
// Read the exported functions, not the SQL.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { hashString } from '../lib/rng.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS queue_message (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_name     TEXT    NOT NULL,
  message_id     TEXT    NOT NULL,
  body           TEXT    NOT NULL,
  visible_at     INTEGER NOT NULL,
  delivery_count INTEGER NOT NULL DEFAULT 0,
  acked_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_queue_ready
  ON queue_message (queue_name, acked_at, visible_at);
`;

function openDb(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export class Queue {
  /**
   * @param {object} options
   * @param {string} options.file  path to the SQLite file holding the queue
   * @param {string} options.name  queue name, e.g. 'market-updates'
   * @param {number} [options.visibilityTimeoutMs]  how long a received message
   *        stays hidden before it is handed out again. Default 3000.
   * @param {number} [options.duplicateRate]  fraction of published messages
   *        that are deliberately written twice. Default 0. Which messages get
   *        duplicated is decided from the message id, so it is reproducible.
   */
  constructor({ file, name, visibilityTimeoutMs = 3000, duplicateRate = 0 }) {
    this.db = openDb(file);
    this.name = name;
    this.visibilityTimeoutMs = visibilityTimeoutMs;
    this.duplicateRate = duplicateRate;
  }

  /** Put a message on the queue. `body` is any JSON-serialisable object. */
  publish(messageId, body) {
    const json = JSON.stringify(body);
    const insert = this.db.prepare(
      `INSERT INTO queue_message (queue_name, message_id, body, visible_at)
       VALUES (?, ?, ?, ?)`
    );
    insert.run(this.name, messageId, json, Date.now());

    // At-least-once, made visible: some messages are simply written twice.
    if (this.duplicateRate > 0) {
      const roll = (hashString(`dup::${messageId}`) % 1000) / 1000;
      if (roll < this.duplicateRate) {
        insert.run(this.name, messageId, json, Date.now());
      }
    }
  }

  /**
   * Take up to `max` messages. Each returned message is hidden from other
   * readers until it is acknowledged or the visibility timeout expires.
   *
   * Returns [{ receiptId, messageId, body, deliveryCount }].
   */
  receive({ max = 10 } = {}) {
    const now = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const rows = this.db
        .prepare(
          `SELECT id, message_id, body, delivery_count
             FROM queue_message
            WHERE queue_name = ? AND acked_at IS NULL AND visible_at <= ?
            ORDER BY RANDOM()
            LIMIT ?`
        )
        .all(this.name, now, max);

      const hide = this.db.prepare(
        `UPDATE queue_message
            SET visible_at = ?, delivery_count = delivery_count + 1
          WHERE id = ?`
      );
      for (const row of rows) hide.run(now + this.visibilityTimeoutMs, row.id);
      this.db.exec('COMMIT');

      return rows.map((row) => ({
        receiptId: row.id,
        messageId: row.message_id,
        body: JSON.parse(row.body),
        deliveryCount: row.delivery_count + 1,
      }));
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Done with it. The message will never be handed out again. */
  ack(receiptId) {
    this.db
      .prepare('UPDATE queue_message SET acked_at = ? WHERE id = ?')
      .run(Date.now(), receiptId);
  }

  /** Give it back now, rather than waiting for the visibility timeout. */
  nack(receiptId) {
    this.db
      .prepare('UPDATE queue_message SET visible_at = ? WHERE id = ?')
      .run(Date.now(), receiptId);
  }

  /** How many messages are still waiting to be acknowledged. */
  pendingCount() {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM queue_message
          WHERE queue_name = ? AND acked_at IS NULL`
      )
      .get(this.name).n;
  }

  close() {
    this.db.close();
  }
}

/**
 * Poll a queue and run `handler` for every message.
 *
 * The handler is awaited. If it returns, the message is acknowledged. If it
 * throws, the message is returned to the queue and will arrive again.
 *
 * Returns { start(), stop() }.
 */
export function consume({
  file,
  name,
  handler,
  pollIntervalMs = 50,
  visibilityTimeoutMs = 3000,
  batchSize = 10,
  onError = (err) => console.error('[queue] handler failed:', err.message),
}) {
  const queue = new Queue({ file, name, visibilityTimeoutMs });
  let running = false;
  let timer = null;

  async function tick() {
    if (!running) return;
    try {
      const messages = queue.receive({ max: batchSize });
      for (const message of messages) {
        try {
          await handler(message);
          queue.ack(message.receiptId);
        } catch (err) {
          queue.nack(message.receiptId);
          onError(err, message);
        }
      }
    } catch (err) {
      onError(err, null);
    }
    if (running) timer = setTimeout(tick, pollIntervalMs);
  }

  return {
    start() {
      if (running) return;
      running = true;
      timer = setTimeout(tick, 0);
    },
    async stop() {
      running = false;
      if (timer) clearTimeout(timer);
      queue.close();
    },
  };
}
