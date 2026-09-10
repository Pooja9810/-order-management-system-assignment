// Starting the system up, driving it, and reading what it produced.
//
// Nothing in here imports anything from src/. The services are started as
// separate processes and talked to over HTTP, exactly as they would be in
// anger, so how they are built inside is nobody's business but the author's.

import { spawn } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '../..');
export const OUT = join(ROOT, 'out');

export const ENTRY_POINTS = {
  order: 'src/order-service/server.js',
  ledger: 'src/ledger-service/server.js',
  driver: 'src/driver/place-orders.js',
};

export const PORTS = {
  security: 4001,
  market: 4002,
  order: 4003,
  ledger: 4004,
};

export const URLS = {
  security: `http://127.0.0.1:${PORTS.security}`,
  market: `http://127.0.0.1:${PORTS.market}`,
  order: `http://127.0.0.1:${PORTS.order}`,
  ledger: `http://127.0.0.1:${PORTS.ledger}`,
};

/** Fail early and clearly when the work has not been started yet. */
export function requireStudentCode() {
  const missing = Object.values(ENTRY_POINTS).filter((p) => !existsSync(join(ROOT, p)));
  if (missing.length > 0) {
    throw new Error(
      `Nothing to test yet: ${missing.join(', ')} does not exist.\n` +
        `These three files are the entry points the tests start:\n` +
        Object.values(ENTRY_POINTS)
          .map((p) => `  - ${p}`)
          .join('\n') +
        `\nEverything else about how you lay the code out is up to you.`
    );
  }
}

export function resetOutputs() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'reports'), { recursive: true });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitForHealth(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'never answered';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return await response.json();
      lastError = `answered ${response.status}`;
    } catch (err) {
      lastError = err.message;
    }
    await sleep(100);
  }
  throw new Error(`${url} did not come up within ${timeoutMs}ms (${lastError})`);
}

export function startProcess(label, scriptPath, env = {}) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = [];
  child.stdout.on('data', (d) => lines.push(String(d)));
  child.stderr.on('data', (d) => lines.push(String(d)));
  child.on('error', (err) => lines.push(`spawn error: ${err.message}`));
  return { label, child, lines, output: () => lines.join('') };
}

export async function stopProcess(handle, signal = 'SIGTERM') {
  if (!handle || handle.child.exitCode !== null || handle.child.killed) return;
  const ended = new Promise((r) => handle.child.once('exit', r));
  handle.child.kill(signal);
  await Promise.race([ended, sleep(3000)]);
}

/** Run the scenario driver to completion. */
export function runDriver(scenarioPath, env = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [ENTRY_POINTS.driver, scenarioPath], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines = [];
    child.stdout.on('data', (d) => lines.push(String(d)));
    child.stderr.on('data', (d) => lines.push(String(d)));
    child.on('error', reject);
    child.on('exit', (code) => resolvePromise({ code, output: lines.join('') }));
  });
}

export async function getJson(url) {
  const response = await fetch(url);
  const body = await response.json();
  return { status: response.status, body };
}

export async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

export async function deleteJson(url) {
  const response = await fetch(url, { method: 'DELETE' });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const TERMINAL = new Set(['FILLED', 'REJECTED', 'CANCELLED']);

/**
 * Wait until every order has reached a state it can no longer leave, and the
 * ledger has been told about all the ones that traded.
 */
export async function settle({ expectedOrders, timeoutMs = 45000 }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      // Three things have to be true at once, or the answers are not final yet:
      // the venue has nothing left to say, the queue has been emptied, and
      // every order that traded has reached the ledger.
      const venue = await getJson(`${URLS.market}/quiet`);
      const { body } = await getJson(`${URLS.order}/orders`);
      const orders = body.orders ?? [];
      const unfinished = orders.filter((o) => !TERMINAL.has(o.status));
      const unposted = orders.filter(
        (o) => TERMINAL.has(o.status) && o.filledQuantity > 0 && !o.postedToLedger
      );
      last = {
        count: orders.length,
        unfinished: unfinished.length,
        unposted: unposted.length,
        venue: venue.body,
      };

      if (
        orders.length >= expectedOrders &&
        unfinished.length === 0 &&
        unposted.length === 0 &&
        venue.body.quiet === true &&
        venue.body.queueDepth === 0
      ) {
        return orders;
      }
    } catch {
      // order-service may be restarting
    }
    await sleep(150);
  }
  const detail = last
    ? `${last.count} orders, ${last.unfinished} still working, ${last.unposted} not yet in the ledger, ` +
      `venue quiet=${last.venue?.quiet} queueDepth=${last.venue?.queueDepth}`
    : 'order-service never answered';
  throw new Error(`the system did not settle within ${timeoutMs}ms (${detail})`);
}

/** Wall-clock values differ every run, so they are blanked before comparing. */
const TIMESTAMP_FIELDS = new Set(['createdAt', 'occurredAt', 'postedAt']);

export function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = TIMESTAMP_FIELDS.has(key) && inner !== null ? '<timestamp>' : normalize(inner);
    }
    return out;
  }
  return value;
}

export function readReport(name) {
  return readFileSync(join(OUT, 'reports', name), 'utf8');
}

export function listReports() {
  return existsSync(join(OUT, 'reports')) ? readdirSync(join(OUT, 'reports')).sort() : [];
}

export function readExpected(fixture, name) {
  return readFileSync(join(ROOT, 'expected', fixture, name), 'utf8');
}

export function loadScenario(fixture) {
  return JSON.parse(readFileSync(join(ROOT, 'data', 'scenarios', `${fixture}.json`), 'utf8'));
}

/**
 * Bring the whole system up for one fixture. Returns the handles plus a stop()
 * that shuts everything down again.
 */
export async function startSystem(scenario) {
  const env = {
    MARKET_SEED: scenario.marketSeed,
    QUEUE_DUPLICATE_RATE: String(scenario.queueDuplicateRate ?? 0),
    QUEUE_VISIBILITY_MS: '2000',
    REPORT_INTERVAL_MS: '600000',
    SECURITY_PORT: String(PORTS.security),
    MARKET_PORT: String(PORTS.market),
    ORDER_PORT: String(PORTS.order),
    LEDGER_PORT: String(PORTS.ledger),
    SECURITY_URL: URLS.security,
    MARKET_URL: URLS.market,
    LEDGER_URL: URLS.ledger,
    ORDER_URL: URLS.order,
  };

  const security = startProcess('security', 'scaffold/security-service/server.js', env);
  const market = startProcess('market', 'scaffold/market-service/server.js', env);
  const ledger = startProcess('ledger', ENTRY_POINTS.ledger, env);
  await waitForHealth(URLS.security);
  await waitForHealth(URLS.market);
  await waitForHealth(URLS.ledger);

  const order = startProcess('order', ENTRY_POINTS.order, env);
  await waitForHealth(URLS.order);

  const handles = { security, market, ledger, order };

  return {
    env,
    handles,
    async restartOrderService(signal = 'SIGKILL') {
      await stopProcess(handles.order, signal);
      handles.order = startProcess('order', ENTRY_POINTS.order, env);
      await waitForHealth(URLS.order, 20000);
      return handles.order;
    },
    async stop() {
      for (const key of ['order', 'ledger', 'market', 'security']) {
        await stopProcess(handles[key]);
      }
    },
  };
}
