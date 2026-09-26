import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import express from "express";
import {
  createOrder,
  getOrderById,
  getAllOrders,
  getOrderByClientOrderId,
  updateMarketOrderId,
  getOrderByMarketOrderId,
  updateAcceptedByMarket,
  insertIntoExecutions,
  updateRejectReason,
} from "./orderHelper.js";
import { fetchSecurity } from "./securityHelper.js";
import { created, ok } from "../helpers/serverHelper.js";
import {
  validateOrderRequest,
  validateOrderWithSecurity,
} from "./validateOrder.js";
import { callMarketService } from "./marketHelper.js";
import { consume } from "../../scaffold/queue/index.js";

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
  const orderRequest = req.body;
  console.log("Request body:", orderRequest);
  let security;
  //Check for missing clientOrderId in orderRequest
  try {
    //validating all fields of an order
    const validationError = validateOrderRequest(orderRequest);
    //any error in validation
    if (validationError) {
      return res
        .status(validationError.status)
        .json({ error: validationError.error });
    }
    //Check if clientOrderId is already in the db

    const existing = getOrderByClientOrderId(db, orderRequest.clientOrderId);
    if (existing) return ok(res, existing);

    //calling fetchSecurity

    security = await fetchSecurity(orderRequest);

    //Validating fields with security
    const securityError = validateOrderWithSecurity(orderRequest, security);
    //any error in validation
    if (securityError) {
      return res
        .status(securityError.status)
        .json({ error: securityError.error });
    }

    //create an order inside the orders table
    const orderResult = createOrder(db, orderRequest, security);

    //Send the order as a response
    console.log("Order present in the orders table:", orderResult);

    //Call the market service
    const marketResponse = await callMarketService(orderResult);
    console.log(marketResponse);

    //update marketOrderId in  the orders db
    updateMarketOrderId(db, orderResult.orderId, marketResponse.marketOrderId);

    //View updated order
    const viewOrder = getOrderById(db, orderResult.orderId);
    console.log("View updated Order", viewOrder);

    return created(res, orderResult);
  } catch (err) {
    console.error(err);

    return res.status(err.status).json({ error: err.error });
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

//cancel an order
app.delete("/orders/:orderId", (req, res) => {
  const order = getOrderById(db, req.params.orderId);

  //check four refusals
  if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  if (
    order.status === "FILLED" ||
    order.status === "CANCELLED" ||
    order.status === "REJECTED"
  )
    return res.status(409).json({ error: "ORDER_NOT_ACTIVE" });
  if (order.cancelRequestedAt !== null && order.cancelOutcome === null) {
    return res.status(409).json({ error: "CANCEL_ALREADY_REQUESTED" });
  }
  if (order.marketOrderId === null) {
    return res.status(409).json({ error: "ORDER_NOT_AT_MARKET" });
  }
});
//call market service
//Using the message queue

const consumer = consume({
  file: process.env.QUEUE_FILE ?? "out/queue.sqlite",
  name: "market-updates",
  visibilityTimeoutMs: 3000,
  async handler({ messageId, body, deliveryCount }) {
    console.log("Queue message received:", body);
    console.log("messageId:", messageId);
    console.log("Delivery count", deliveryCount);

    const order = getOrderByMarketOrderId(db, body.marketOrderId);
    //if order is falsy
    if (!order) {
      throw new Error(`Order not found : ${body.marketOrderId}`);
    }
    //If the message received has type accepted
    if (body.type === "ACCEPTED") {
      updateAcceptedByMarket(db, body.marketOrderId);
    }

    //If the message received has type FILL
    //we have to insert into exec table
    if (body.type === "FILL") {
      const fillType = insertIntoExecutions(db, order.orderId, body);

      if (!fillType) {
        return { status: 404, error: "Error while insert into execution" };
      }
    }

    //If the message received has type REJECTED

    if (body.type === "REJECTED") {
      updateRejectReason(db, body, order.orderId);
    }
  },
});

consumer.start();

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
