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
  return db.prepare("SELECT * FROM orders WHERE orderId = ?").get(orderId);
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
