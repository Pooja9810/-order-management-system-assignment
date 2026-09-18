import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import express from "express";
import { createOrder, getOrderById, getAllOrders } from "./orderHelper.js";
import { fetchSecurity } from "./securityHelper.js";

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
    orderId INTEGER NOT NULL REFERENCES orders(orderId),
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
const absoluteDbPath = join(
  import.meta.dirname,
  "..",
  "..",
  "out",
  "order-service.sqlite",
);
console.log(absoluteDbPath);
const db = openDb(absoluteDbPath);

//express file
//import express from "express";
const app = express();
const PORT = 4003;

//This helps express read json from request bodies

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({
    status: "UP",
  });
});

//POST/orders
app.post("/orders", async (req, res) => {
  try {
    const orderRequest = req.body;
    console.log("Request body:", orderRequest);

    //calling fetchSecurity
    const security = await fetchSecurity(orderRequest);

    //create an order inside the orders table
    const orderResult = createOrder(db, orderRequest, security);

    //Send the order as a response
    console.log("Order present in the orders table:", orderResult);
    res.status(201).json(orderResult);
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.error });
    }
  }
});

//get all orders
app.get("/orders", (req, res) => {
  try {
    //calling getAllOrders from orderHelper.js fn
    const orders = getAllOrders(db);
    //Return the sql result
    res.json(orders);
  } catch (error) {
    console.error("SQL error", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

//get orders/:orderId
app.get("/orders/:orderId", (req, res) => {
  try {
    const order = getOrderById(db, req.params.orderId);
    if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
    res.json(order);
  } catch (error) {
    console.error("SQL error", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
