export const createOrder = (db, body, security) => {
  console.log("Request bodY:", `${body.clientOrderId}`, security);

  const stmt =
    db.prepare(`INSERT INTO orders (clientOrderId,securityId,symbol,venue,currency,assetType,
      contractMultiplier,side,quantity,orderType,limitPriceMinor,createdAt)
    values (?,?,?,?,?,?,?,?,?,?,?,?)`);

  const orderResult = stmt.run(
    body.clientOrderId,
    security.securityId,
    security.symbol,
    security.venue,
    security.currency,
    security.assetType,
    security.contractMultiplier,
    body.side,
    body.quantity,
    body.orderType,
    body.limitPriceMinor ?? null,
    new Date().toISOString(),
  );

  const orderId = orderResult.lastInsertRowid;

  console.log("New orderId:", orderId);
  return orderResult.lastInsertRowid;
};
