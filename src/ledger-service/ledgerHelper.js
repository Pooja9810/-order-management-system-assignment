//insert into post_orders
export const insertIntoPostOrders = (db, orderRequest) => {
  try {
    console.log(`Creating a ledger entry for orderId: ${orderRequest.orderId}`);
    console.log(orderRequest);

    const stmt = db.prepare(
      `INSERT INTO post_orders (orderId,securityId,postedAt,symbol,venue,currency,assetType,
      contractMultiplier,side,finalStatus) values(?,?,?,?,?,?,?,?,?,?)RETURNING *`,
    );
    const orderResult = stmt.get(
      orderRequest.orderId,
      orderRequest.securityId,
      new Date().toISOString(),
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
//insert into post_executions acc to orderId
export const insertIntoPostExecutions = (db, orderRequest) => {
  try {
    console.log(
      `Creating a ledger entry for executions: ${orderRequest.orderId}`,
    );

    const stmt = db.prepare(
      `INSERT INTO post_executions(execId,orderId,executedQuantity,priceMinor,occurredAt)values(?,?,?,?,?)RETURNING *`,
    );
    let execResult;
    if (orderRequest.executions && Array.isArray(orderRequest.executions)) {
      for (const execution of orderRequest.executions) {
        console.log(
          `Creating a ledger entry for execution: ${execution.execId} under orderId: ${orderRequest.orderId}`,
        );

        execResult = stmt.get(
          execution.execId,
          orderRequest.orderId,
          execution.executedQuantity,
          execution.priceMinor,
          execution.occurredAt,
        );
      }
    }
    return execResult;
  } catch (error) {
    console.error("Error while inserting into post_executions", error);
  }
};

export const getAllOrders = (db) => {
  try {
    const orders = db
      .prepare("SELECT * FROM post_orders ORDER BY orderId ASC")
      .all();

    //Loop through each order
    return orders.map((order) => {
      const trades = db
        .prepare(
          "SELECT execId, executedQuantity, priceMinor, occurredAt FROM post_executions WHERE orderId = ?",
        )
        .all(order.orderId);

      // Return the order object with its executions
      return {
        ...order,
        trades,
      };
    });
  } catch (error) {
    console.error("Error while fetching all orders:", error);
    return [];
  }
};
