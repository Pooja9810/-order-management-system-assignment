export const insertIntoPostOrders = (db, orderRequest) => {
  try {
    console.log(`Creating a ledger entry for orderId: ${orderRequest.orderId}`);
    console.log(orderRequest);

    const stmt = db.prepare(
      `INSERT INTO post_orders (orderId,securityId,symbol,venue,currency,assetType,
      contractMultiplier,side,finalStatus) values(?,?,?,?,?,?,?,?,?)`,
    );
    const orderResult = stmt.run(
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

export const insertIntoPostExecutions = (db, orderRequest) => {
  try {
    console.log(
      `Creating a ledger entry for executions: ${orderRequest.orderId}`,
    );

    const stmt = db.prepare(
      `INSERT INTO post_executions(execId,orderId,executedQuantity,priceMinor,occurredAt)values(?,?,?,?,?)`,
    );
    let execResult;
    if (orderRequest.executions && Array.isArray(orderRequest.executions)) {
      for (const execution of orderRequest.executions) {
        console.log(
          `Creating a ledger entry for execution: ${execution.execId} under orderId: ${orderRequest.orderId}`,
        );

        execResult = stmt.run(
          execution.execId,
          orderRequest.orderId,
          execution.executedQuantity,
          execution.priceMinor,
          execution.occurredAt,
        );
        return execResult;
      }
    }
  } catch (error) {
    console.error("Error while inserting into post_executions", error);
  }
};
