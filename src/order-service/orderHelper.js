export const createOrder = (db, body) => {
  console.log("Request bodY:", body, db);
  // db.exec(
  //   `INSERT INTO orders (clientOrderId,securityId,symbol,venue,currency,assetType,contractMultiplier,side,quantity,orderType,createdAt)
  //   values ('6780909','SEC-TSLA', 'TSLA', 'NASDAQ', 'USD', 'EQUITY', '1', 'BUY', '10', 'LIMIT', CURRENT_TIMESTAMP)`,
  // );
};
