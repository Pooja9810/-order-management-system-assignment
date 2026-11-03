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
  releaseReservation,
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
    createdAt TEXT NOT NULL,
     accountId TEXT NOT NULL,
    reservationReleased INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS executions (
    execId TEXT NOT NULL PRIMARY KEY,
    orderId INTEGER NOT NULL REFERENCES orders(orderId),
    sequence INTEGER NOT NULL,
    executedQuantity INTEGER NOT NULL,
    priceMinor INTEGER NOT NULL,
    occurredAt TEXT NOT NULL
  );

     CREATE TABLE IF NOT EXISTS accounts (
     accountId TEXT PRIMARY KEY,
     cashBalanceMinor INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS positions (
    accountId TEXT NOT NULL,
    securityId TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    PRIMARY KEY (accountId, securityId)
  );
  `;

const addStatusColumn = `ALTER TABLE orders ADD COLUMN status TEXT DEFAULT "NEW"`;

const SEED_TEST_ACCOUNT = `
    INSERT OR IGNORE INTO accounts (accountId, cashBalanceMinor)VALUES
    ('ACC-123', 1000000);

  INSERT OR IGNORE INTO positions (accountId, securityId, quantity) VALUES
    ('ACC-123', 'SEC-1001', 50);
`;

function openDb(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  db.exec(SEED_TEST_ACCOUNT);
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
//hosts like Render pick the public port, locally it stays 4003
const PORT = Number(process.env.PORT ?? 4003);

//This helps express read json from request bodies

app.use(express.json());
app.use(express.static("public"));

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

//GET the cash balance of an account
app.get("/accounts/:accountId", (req, res) => {
  const account = db
    .prepare("SELECT * FROM accounts WHERE accountId = ?")
    .get(req.params.accountId);
  if (!account) return res.status(404).json({ error: "ACCOUNT_NOT_FOUND" });
  return res.json(account);
});

//GET all positions of an account
app.get("/positions/:accountId", (req, res) => {
  const positions = db
    .prepare("SELECT * FROM positions WHERE accountId = ?")
    .all(req.params.accountId);
  return res.json({ positions });
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

    //Pre-trade check: the account must exist
    const { accountId } = orderRequest;
    if (typeof accountId !== "string" || accountId.trim() === "") {
      return res.status(400).json({ error: "MISSING_ACCOUNT_ID" });
    }
    const account = db
      .prepare("SELECT cashBalanceMinor FROM accounts WHERE accountId = ?")
      .get(accountId);
    if (!account) {
      return res.status(400).json({ error: "ACCOUNT_NOT_FOUND" });
    }

    //A MARKET BUY has no price yet, so there is no amount to reserve
    if (orderRequest.side === "BUY" && orderRequest.orderType === "MARKET") {
      return res.status(400).json({ error: "MARKET_BUY_NOT_SUPPORTED" });
    }

    //Pre-trade check: enough cash for a BUY, enough shares for a SELL
    const costMinor =
      orderRequest.side === "BUY"
        ? orderRequest.quantity *
          orderRequest.limitPriceMinor *
          security.contractMultiplier
        : 0;
    if (orderRequest.side === "BUY" && account.cashBalanceMinor < costMinor) {
      return res.status(400).json({ error: "INSUFFICIENT_FUNDS" });
    }
    if (orderRequest.side === "SELL") {
      const position = db
        .prepare(
          "SELECT quantity FROM positions WHERE accountId = ? AND securityId = ?",
        )
        .get(accountId, security.securityId);
      if ((position?.quantity ?? 0) < orderRequest.quantity) {
        return res.status(400).json({ error: "INSUFFICIENT_SHARES" });
      }
    }

    //Reserve the cash or shares and save the order together, or not at all
    let orderResult;
    db.exec("BEGIN IMMEDIATE");
    try {
      if (orderRequest.side === "BUY") {
        db.prepare(
          "UPDATE accounts SET cashBalanceMinor = cashBalanceMinor - ? WHERE accountId = ?",
        ).run(costMinor, accountId);
      } else {
        db.prepare(
          "UPDATE positions SET quantity = quantity - ? WHERE accountId = ? AND securityId = ?",
        ).run(orderRequest.quantity, accountId, security.securityId);
      }
      //create an order inside the orders table
      orderResult = createOrder(db, orderRequest, security, accountId);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    //Send the order as a response
    console.log("Order present in the orders table:", orderResult);

    //Call the market service
    let marketResponse;
    try {
      marketResponse = await createOrderInMarket(orderResult);
      if (!marketResponse?.marketOrderId) {
        throw new Error("Market service gave no marketOrderId");
      }
    } catch (err) {
      //the order never reached the exchange, so give the reservation back
      console.error(err);
      releaseReservation(db, orderResult);
      return res.status(502).json({ error: "MARKET_SERVICE_UNAVAILABLE" });
    }

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
