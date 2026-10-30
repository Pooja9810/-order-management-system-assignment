import { orderResponse, getStatus } from "./completeOrder.js";
import { postOrderToLedger } from "./postOrderToLedger.js";
export const createOrder = (db, orderRequest, security, accountId) => {
  try {
    console.log(
      `About to create an order for clientOrderId: ${orderRequest.clientOrderId}`,
    );

    const stmt =
      db.prepare(`INSERT INTO orders (clientOrderId,securityId,symbol,venue,currency,assetType,
           contractMultiplier,side,quantity,orderType,limitPriceMinor,createdAt,accountId)
    values (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`);

    const orderResult = stmt.get(
      orderRequest.clientOrderId,
      security.securityId,
      security.symbol,
      security.venue,
      security.currency,
      security.assetType,
      security.contractMultiplier,
      orderRequest.side,
      orderRequest.quantity,
      orderRequest.orderType,
      orderRequest.limitPriceMinor ?? null,
      new Date().toISOString(),
      accountId,
    );

    //Return the current order
    return orderResult;
  } catch (err) {
    throw new Error(`Error creating order ${orderRequest.clientOrderId}`, {
      cause: err,
    });
  }
};

export const getOrderById = (db, orderId) => {
  let order = db.prepare("SELECT * FROM orders WHERE orderId = ?").get(orderId);

  if (!order) return null;
  const executions = getExecutionsByOrderId(db, orderId);

  //call complete order
  const completeOrder = orderResponse(order, executions);
  return completeOrder;
};

//get executions by orderId

export const getExecutionsByOrderId = (db, orderId) => {
  let stmt = db.prepare("SELECT * FROM executions WHERE orderId = ?");
  return stmt.all(orderId);
};

export const getOrderByClientOrderId = (db, clientOrderId) => {
  const stmt = db.prepare("SELECT * FROM orders WHERE clientOrderId = ?");
  return stmt.get(clientOrderId);
};

export const getAllOrders = (db) => {
  let orders = db.prepare("SELECT * FROM orders ORDER BY orderId ASC").all();
  return orders.map((order) => {
    const executions = getExecutionsByOrderId(db, order.orderId);
    return orderResponse(order, executions);
  });
};

//update marketOrderId in the orders table

export const updateMarketOrderId = (db, orderId, marketOrderId) => {
  let stmt = db.prepare(
    "UPDATE orders SET marketOrderId = ? WHERE orderId = ?",
  );
  return stmt.get(marketOrderId, orderId);
};

//get order by marketOrderId

export const getOrderByMarketOrderId = (db, marketOrderId) => {
  let stmt = db.prepare("SELECT * FROM orders WHERE marketOrderId = ?");
  return stmt.get(marketOrderId);
};

//update the acceptedByMarket field in orders db
export const updateAcceptedByMarket = (db, marketOrderId) => {
  let stmt = db.prepare(
    "UPDATE orders SET acceptedByMarket = 1 where marketOrderId =? ",
  );
  return stmt.run(marketOrderId);
};

//update the rejectReason of an order
export const updateRejectReason = (db, orderId, reason) => {
  let stmt = db.prepare(
    "UPDATE orders SET rejectReason = ? where orderId =? returning *",
  );
  return stmt.run(reason, orderId);
};

//update the cancelRequestedAt field in the db
export const updateCancelRequestedAt = (db, orderId) => {
  let stmt = db.prepare(
    "UPDATE orders SET cancelRequestedAt = ? where orderId =? ",
  );
  return stmt.run(new Date().toISOString(), orderId);
};

//update cancelOutcome to "cancelled"

export const updateCancelOutcomeToCancelled = (db, marketOrderId) => {
  let stmt = db.prepare(
    "UPDATE orders SET cancelOutcome = 'CANCELLED' where marketOrderId = ?",
  );
  return stmt.run(marketOrderId);
};

//update cancelOutcome to 'REJECTED
export const updateCancelOutcomeToCancelRejected = (
  db,
  marketOrderId,
  reason,
) => {
  let stmt = db.prepare(
    "UPDATE orders SET cancelOutcome = 'REJECTED',cancelRejectReason =? where marketOrderId = ?",
  );
  return stmt.run(reason, marketOrderId);
};
//insert into executions table

export const insertIntoExecutions = (db, orderId, exec) => {
  let stmt = db.prepare(
    `INSERT INTO executions (execId, orderId,sequence, executedQuantity, priceMinor, occurredAt)
     values(?,?,?,?,?,?)
     ON CONFLICT DO NOTHING`,
  );
  return stmt.run(
    exec.execId,
    orderId,
    exec.sequence,
    exec.lastQuantity,
    exec.lastPriceMinor,
    exec.occurredAt,
  );
};

//update cash and shares for one new fill
//the cash (BUY) or shares (SELL) were already taken when the order was placed
export const applyFillToBalances = (db, order, exec) => {
  const quantity = exec.lastQuantity;
  const multiplier = order.contractMultiplier;
  const fillValueMinor = quantity * exec.lastPriceMinor * multiplier;
  //a fill can arrive after a cancel has already given the reservation back
  const released = order.reservationReleased === 1;

  if (order.side === "BUY") {
    const reservedMinor = quantity * order.limitPriceMinor * multiplier;
    db.prepare(
      "UPDATE accounts SET cashBalanceMinor = cashBalanceMinor + ? WHERE accountId = ?",
    ).run(
      released ? -fillValueMinor : reservedMinor - fillValueMinor,
      order.accountId,
    );
    db.prepare(
      `INSERT INTO positions (accountId, securityId, quantity)
       VALUES (?, ?, ?)
       ON CONFLICT (accountId, securityId)
       DO UPDATE SET quantity = quantity + excluded.quantity`,
    ).run(order.accountId, order.securityId, quantity);
  } else {
    db.prepare(
      "UPDATE accounts SET cashBalanceMinor = cashBalanceMinor + ? WHERE accountId = ?",
    ).run(fillValueMinor, order.accountId);
    if (released) {
      db.prepare(
        "UPDATE positions SET quantity = quantity - ? WHERE accountId = ? AND securityId = ?",
      ).run(quantity, order.accountId, order.securityId);
    }
  }
};

//give back whatever is still reserved when an order is rejected or cancelled
export const releaseReservation = (db, order) => {
  db.exec("BEGIN IMMEDIATE");
  try {
    const marked = db
      .prepare(
        "UPDATE orders SET reservationReleased = 1 WHERE orderId = ? AND  reservationReleased = 0",
      )
      .run(order.orderId);
    //changes is 0 when it was already released (a duplicate message)
    if (marked.changes === 1) {
      const filled = getExecutionsByOrderId(db, order.orderId).reduce(
        (sum, e) => sum + e.executedQuantity,
        0,
      );
      const leaves = order.quantity - filled;
      if (order.side === "BUY") {
        db.prepare(
          "UPDATE accounts SET cashBalanceMinor = cashBalanceMinor + ? WHERE  accountId = ?",
        ).run(
          leaves * order.limitPriceMinor * order.contractMultiplier,
          order.accountId,
        );
      } else {
        db.prepare(
          "UPDATE positions SET quantity = quantity + ? WHERE accountId = ? AND securityId = ?",
        ).run(leaves, order.accountId, order.securityId);
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
};

//check if status column exists

export const statusExists = (db) => {
  let stmt = db
    .prepare(
      "SELECT COUNT(*) as count FROM pragma_table_info('orders') WHERE name='status'",
    )
    .get();
  return stmt.count > 0;
};

//Updating the status column after any change in executions table
export const refreshStatus = (db, order) => {
  const executions = getExecutionsByOrderId(db, order.orderId);
  const filledQuantity = executions.reduce(
    (sum, e) => sum + e.executedQuantity,
    0,
  );

  const status = getStatus(order, filledQuantity);
  db.prepare("UPDATE orders SET status = ? WHERE orderId = ?").run(
    status,
    order.orderId,
  );
};

//marked as posted in ledger

export const markOrderAsPosted = (db, orderId) => {
  db.prepare("UPDATE orders SET postedToLedger = 1 WHERE orderId = ?").run(
    orderId,
  );
};
//check and post to ledger

export const checkAndPostToLedger = async (db, orderId) => {
  const order = getOrderById(db, orderId);
  const isFinished = ["FILLED", "CANCELLED", "REJECTED"].includes(order.status);
  const hasExecutions = order.executions.length > 0;
  const notYetPosted = order.postedToLedger === false;
  console.log(
    `Current order ${order.orderId} has order status ${order.status}-${isFinished}, includes executions-${hasExecutions} and notYetPosted -${notYetPosted}`,
  );
  //console.log(order.executions);

  if (isFinished && hasExecutions && notYetPosted) {
    // call postOrderToLedger
    console.log(`\n Calling postOrderToLedger`);
    const ledger = await postOrderToLedger(order, order.executions);
    // mark as posted
    if (ledger.orderId || ledger.status === 409) {
      markOrderAsPosted(db, order.orderId);
      console.log(`\nOrder ${order.orderId} has been posted to the ledger`);
    }
  }
};
