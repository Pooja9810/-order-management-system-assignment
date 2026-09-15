import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import express from "express";
//import { hashString } from "../lib/rng.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
 orderId INTEGER PRIMARY KEY ,
 clientOrderId TEXT    NOT NULL UNIQUE,
  marketOrderId     TEXT,
  securityId  TEXT    NOT NULL,
  symbol TEXT NOT NULL,
  venue TEXT NOT NULL,
  currency TEXT NOT NULL,
  assetType TEXT NOT NULL,
  contractMultiplier INTEGER NOT NULL,
  side TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  orderType TEXT NOT NULL,
  limitPriceMinor INTEGER,
  acceptedByMarket BOOLEAN,
  cancelOutcome TEXT,
  cancelRequestedAt TEXT,
  rejectReason TEXT,
  cancelRejectReason TEXT,
  postedToLedger BOOLEAN,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS executions (
execId TEXT NOT NULL PRIMARY KEY,
order_id INTEGER NOT NULL REFERENCES orders(order_id),
sequence INTEGER NOT NULL,
executedQuantity INTEGER NOT NULL,
priceMinor INTEGER NOT NULL,
occurredAt TEXT NOT NULL
)


`;

function openDb(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  return db;
}
//Calling openDb so that db gets created
openDb("out/order-service.sqlite");

//express file
//import express from "express";
const app = express();
const PORT = 4003;

//THIS helps express read json from request bodeis

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({
    status: "UP",
  });
});

//POST/orders
app.post("/orders", async (req, res) => {
  //const response = await fetch("http://localhost:4003");
  const data = req.body;
  console.log(data);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
