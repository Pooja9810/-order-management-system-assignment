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
  updateCancelRequestedAt,
  statusExists,
  checkAndPostToLedger,
} from "./orderHelper.js";
import { fetchSecurity } from "./securityHelper.js";
import { created, ok } from "../helpers/serverHelper.js";
import {
  validateOrderRequest,
  validateOrderWithSecurity,
} from "./validateOrder.js";
import { createOrderInMarket, cancelMarketOrder } from "./marketHelper.js";
import { startMarketConsumerService } from "./marketConsumer.js";
import { OrderStatus } from "./constants.js";

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

const addStatusColumn = `ALTER TABLE orders ADD COLUMN status TEXT DEFAULT "NEW"`;

function openDb(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  //check if column status exists already

  if (!statusExists(db)) {
    db.exec(addStatusColumn);
    console.log("Status column added to the database");
  }
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

app.use((err, req, res, next) => {
  // If the crash came from the express.json() parser
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "MALFORMED_JSON" });
  }

  // Pass any other system errors down the chain
  next(err);
});

app.get("/health", (req, res) => {
  return res.json({
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
    if (existing) return ok(res, getOrderById(db, existing.orderId));

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
    const marketResponse = await createOrderInMarket(orderResult);
    console.log("Order sent to market successfully:", marketResponse);

    //update marketOrderId in  the orders db
    updateMarketOrderId(db, orderResult.orderId, marketResponse.marketOrderId);
    //fetch the order with updated fields
    const updatedOrder = getOrderById(db, orderResult.orderId);
    //return with all calculated fields
    return created(res, updatedOrder);
  } catch (err) {
    console.error(err);

    return res.status(err.status).json({ error: err.error });
  }
});

//get orders/:orderId
app.get("/orders/:orderId", (req, res) => {
  try {
    const order = getOrderById(db, req.params.orderId);
    if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
    return res.json(order);
  } catch (error) {
    console.error("SQL error", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

//getAllOrders and  status = "WORKING"
app.get("/orders", (req, res) => {
  try {
    const { status } = req.query;
    console.log("URL STATUS:", status);
    if (status && !Object.values(OrderStatus).includes(status)) {
      return res.status(400).json({ error: "INVALID_STATUS" });
    }
    //if status present in url

    const orders = status
      ? //filter through the orders and keep matching status
        getAllOrders(db).filter((o) => o.status === status)
      : //else get all orders
        getAllOrders(db);

    return res.json({ orders });
  } catch (error) {
    console.error("SQL error", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

//cancel an order - when order is  filled, cancelled or rejected
app.delete("/orders/:orderId", async (req, res) => {
  console.log("@@@@@@@@@@@@@", req.params);

  const order = getOrderById(db, req.params.orderId);

  //check four refusals
  if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  if (
    order.status === "FILLED" ||
    order.status === "CANCELLED" ||
    order.status === "REJECTED"
  )
    return res.status(409).json({ error: "ORDER_NOT_ACTIVE" });
  if (order.cancelRequested && order.cancelOutcome === null) {
    return res.status(409).json({ error: "CANCEL_ALREADY_REQUESTED" });
  }
  if (order.marketOrderId === null) {
    return res.status(409).json({ error: "ORDER_NOT_AT_MARKET" });
  }

  //call the cancel order fn
  await cancelMarketOrder(order.marketOrderId);

  //update the cancelRequestedAt field in the db
  updateCancelRequestedAt(db, order.orderId);

  //view updated order
  const updatedOrder = getOrderById(db, order.orderId);
  return res.status(202).json(updatedOrder);
});

//call marketconsumer to utilize message queue
startMarketConsumerService(db);

//check for unposted order from the orders db on startup
const unpostedOrders = getAllOrders(db).filter(
  (order) =>
    ["FILLED", "CANCELLED", "REJECTED"].includes(order.status) &&
    order.executions.length > 0 &&
    order.postedToLedger === false,
);

for (const order of unpostedOrders) {
  console.log(`On startup posting unposted order ${order.orderId}`);
  await checkAndPostToLedger(db, order.orderId);
}
//Catch invalid routes
app.use((req, res) => {
  return res.status(404).json({ error: "NOT_FOUND" });
});
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
