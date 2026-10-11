export const createOrder = (db, orderRequest) => {
  try {
    console.log(`Creating a ledger entry for orderId: ${orderRequest.orderId}`);

    const stmt = db.prepare(
      `INSERT INTO post_orders(orderId,securityId,symbol,venue,currency,assetType,
      contractMultiplier,side,finalStatus)values(?,?,?,?,?,?,?,?,?)`,
    );
    const orderResult = stmt.get(
      orderRequest.orderId,
      orderRequest.securityId,
      orderRequest.symbol,
      orderRequest.venue,
      orderRequest.currency,
      orderRequest.assetType,
      orderRequest.contractMultiplier,
      orderRequest.side,
      orderRequest.finalStatus,
    );
    return orderResult;
  } catch (error) {
    console.error("Error while inserting into post_orders", error);
  }
};
