export const createOrder = (db, body, security) => {
  console.log("Request bodY:", `${body.clientOrderId}`);
  db.exec(
    `INSERT INTO orders (clientOrderId,securityId,symbol,venue,currency,assetType,contractMultiplier,side,quantity,orderType,createdAt)
    values ('${body.clientOrderId}','${security.securityId}', '${security.symbol}', '${security.venue}', '${security.currency}', '${security.assetType}', 
    '${security.contractMultiplier}', '${body.side}', '${body.quantity}', '${body.orderType}', CURRENT_TIMESTAMP)`,
  );
};
