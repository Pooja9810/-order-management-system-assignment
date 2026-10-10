import express from "express";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const app = express();
const PORT = 4004;

//This helps express read json from request bodies

app.use(express.json());

//health route

app.get("/health", (req, res) => {
  return res.json({
    status: "UP",
  });
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS post_orders(
    orderId INTEGER PRIMARY KEY,
    securityId TEXT NOT NULL,
    postedAt TEXT NOT NULL,
    symbol TEXT NOT NULL,
    venue TEXT NOT NULL,
    currency TEXT NOT NULL,
    assetType TEXT NOT NULL,
    contractMultiplier INTEGER NOT NULL,
    side TEXT NOT NULL,
    finalStatus TEXT NOT NULL
);
 CREATE TABLE IF NOT EXISTS post_executions (
    execId TEXT NOT NULL PRIMARY KEY,
    orderId INTEGER NOT NULL REFERENCES post_orders(orderId)
    executedQuantity INTEGER NOT NULL,
    priceMinor INTEGER NOT NULL,
    occurredAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS report_counter (
  id INTEGER PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
)`;

function openDb(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  return db;
}
//Calling openDb so that db gets created
const absoluteDbPath = join(
  import.meta.dirname,
  "..",
  "..",
  "out",
  "ledger-service.sqlite",
);
console.log(absoluteDbPath);
const db = openDb(absoluteDbPath);

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
