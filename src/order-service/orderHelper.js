export const createOrder = (db, orderRequest, security) => {
  try {
    console.log(
      `About to create an order for clientOrderId: ${orderRequest.clientOrderId}`,
    );

    const stmt =
      db.prepare(`INSERT INTO orders (clientOrderId,securityId,symbol,venue,currency,assetType,
      contractMultiplier,side,quantity,orderType,limitPriceMinor,createdAt)
    values (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`);

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

  const executions = getExecutionsByOrderId(db, orderId);
  return orderResponse(order, executions);
};

//complete order including executions as a response to GET/orders:orderId
export const orderResponse = (order, executions) => {
  //calculate filledQuantity
  let filledQuantity = 0;
  for (const e of executions) {
    filledQuantity += e.executedQuantity;
  }

  //calculate leavesQuantity
  const leavesQuantity = Math.max(0, order.quantity - filledQuantity);

  // calculate averagePriceMinor

  let totalValue = 0;
  let totalQuantity = 0;

  for (const e of executions) {
    totalQuantity += e.executedQuantity;
    totalValue += e.executedQuantity * e.priceMinor;
  }

  const averagePriceMinor = Math.round(totalValue / totalQuantity);

  //calculate grossNationalMinor
  let grossNationalMinor = 0;

  for (const e of executions) {
    grossNationalMinor += e.executedQuantity * e.priceMinor;
  }
  grossNationalMinor *= order.contractMultiplier;

  //assign status

  return {
    ...order,
    filledQuantity,
    leavesQuantity,
    averagePriceMinor,
    grossNationalMinor,
  };
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
  let stmt = db.prepare("SELECT * FROM orders");
  return stmt.all();
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

//insert into executions table

export const insertIntoExecutions = (db, orderId, exec) => {
  let stmt = db.prepare(
    `INSERT INTO executions(execId, orderId,sequence, executedQuantity, priceMinor, occurredAt) values(?,?,?,?,?,?)`,
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
