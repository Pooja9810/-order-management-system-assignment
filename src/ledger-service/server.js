import express from "express";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { validateLedgerRequest } from "./validateLedgerRequest.js";
import {
  insertIntoPostOrders,
  insertIntoPostExecutions,
  getAllOrders,
} from "./ledgerHelper.js";
import { generateReport } from "./report.js";

const app = express();
const PORT = 4004;

//This helps express read json from request bodies

app.use(express.json());
app.use((err, req, res, next) => {
  // If the crash came from the express.json() parser
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "MALFORMED_JSON" });
  }

  // Pass any other system errors down the chain
  next(err);
});
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
    orderId INTEGER NOT NULL REFERENCES post_orders(orderId),
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

//POST /post-order
app.post("/post-order", async (req, res) => {
  const postOrderReq = req.body;
  console.log("Post orders", postOrderReq);

  //validate ledger request
  const validateError = validateLedgerRequest(postOrderReq, db);
  if (validateError) {
    return res
      .status(validateError.status)
      .json({ error: validateError.error });
  }

  //insert into post_orders table
  const orderResult = insertIntoPostOrders(db, postOrderReq);

  //insert into post_executions table
  const execResult = insertIntoPostExecutions(db, postOrderReq);

  //Send the order as a response
  console.log("Order present in the post_orders table:", orderResult);
  console.log("Execution present in the post_executions table:", execResult);

  return res.status(201).json({
    orderId: postOrderReq.orderId,
    postedAt: orderResult.postedAt,
    tradeCount: postOrderReq.executions.length,
  });
});

// //POST/ generate report
app.post("/generate-report", async (req, res) => {
  const report = generateReport(db);
  return res.status(201).json(report);
});

//GET post_orders

app.get("/posted-orders", (req, res) => {
  try {
    const allOrders = getAllOrders(db);
    console.log(allOrders);
    res.json({ postedOrders: allOrders });
  } catch (error) {
    console.error("Error handling GET /post-orders:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
