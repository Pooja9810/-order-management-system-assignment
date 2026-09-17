export const createOrder = (db, orderRequest, security) => {
  console.log(
    `About to create an order for clientOrderId: ${orderRequest.clientOrderId}`,
  );

  const stmt =
    db.prepare(`INSERT INTO orders (clientOrderId,securityId,symbol,venue,currency,assetType,
      contractMultiplier,side,quantity,orderType,limitPriceMinor,createdAt)
    values (?,?,?,?,?,?,?,?,?,?,?,?)`);

  const orderResult = stmt.run(
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

  const orderId = orderResult.lastInsertRowid;

  //Return the current order

  const order = db
    .prepare("SELECT * FROM orders WHERE orderId = ?")
    .get(orderId);
  return order;
};

export const getOrderById = (db, orderId) => {
  return db.prepare("SELECT * FROM orders WHERE orderId = ?").get(orderId);
};
