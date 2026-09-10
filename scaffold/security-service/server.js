// security-service
//
// Read-only reference data about securities. Its database is a JSON file.
// It is the only thing in the system that knows what a securityId means.
//
//   GET /health
//   GET /info/:securityId   -> one security, or 404
//   GET /search?symbol=XXX  -> every security trading under that symbol
//
// Note the shape of /search: a symbol is NOT unique. The same symbol can be
// listed on more than one venue, in more than one currency, as more than one
// security. That is why /info takes a securityId and not a symbol.

import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dataFile =
  process.env.SECURITIES_FILE ?? resolve(here, '../../data/securities.json');

const { securities } = JSON.parse(readFileSync(dataFile, 'utf8'));
const bySecurityId = new Map(securities.map((s) => [s.securityId, s]));

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ service: 'security-service', status: 'UP', count: securities.length });
});

app.get('/info/:securityId', (req, res) => {
  const security = bySecurityId.get(req.params.securityId);
  if (!security) {
    return res.status(404).json({
      error: 'SECURITY_NOT_FOUND',
      message: `no security with id ${req.params.securityId}`,
    });
  }
  res.json(security);
});

app.get('/search', (req, res) => {
  const symbol = req.query.symbol;
  if (typeof symbol !== 'string' || symbol.trim() === '') {
    return res.status(400).json({
      error: 'MISSING_SYMBOL',
      message: 'query parameter "symbol" is required',
    });
  }
  const wanted = symbol.trim().toUpperCase();
  const results = securities.filter((s) => s.symbol.toUpperCase() === wanted);
  res.json({ symbol: wanted, count: results.length, results });
});

const port = Number(process.env.SECURITY_PORT ?? 4001);
app.listen(port, () => {
  console.log(`[security-service] listening on ${port}, ${securities.length} securities`);
});
