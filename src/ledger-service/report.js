//extract details from post_orders and post_executions
export function generateReport(db) {
  let post_orders = db.prepare(`SELECT * FROM post_orders`).all();

  let post_executions = db.prepare(`SELECT * FROM post_executions`).all();

  let inventoryFields = db
    .prepare(
      `SELECT p.securityId AS security_id,
      p.symbol,p.assetType AS asset_type,
      p.venue,p.currency,
      p.contractMultiplier AS contract_multiplier,

      SUM(CASE WHEN p.side = 'BUY' THEN e.executedQuantity ELSE 0 END) AS buy_quantity,
      SUM(CASE WHEN p.side = 'SELL' THEN e.executedQuantity ELSE 0 END) AS sell_quantity,


      (SUM(CASE WHEN p.side = 'BUY' THEN e.executedQuantity ELSE 0 END) -
      SUM(CASE WHEN p.side = 'SELL' THEN e.executedQuantity ELSE 0 END))  AS net_quantity,

      (SUM(CASE WHEN p.side = 'BUY' THEN e.executedQuantity ELSE 0 END) -
      SUM(CASE WHEN p.side = 'SELL' THEN e.executedQuantity ELSE 0 END)) * p.contractMultiplier AS net_units,


      COUNT(p.orderId) AS tradeCount,
        
      SUM(e.executedQuantity * e.priceMinor *  p.contractMultiplier) AS gross_notional_minor

      from post_orders p 
      JOIN post_executions e
      ON p.orderId = e.orderId
      GROUP BY p.securityId
      ORDER BY p.securityId ASC`,
    )
    .all();

  let venue_fields = db
    .prepare(
      `SELECT p.venue AS venue,
       p.currency AS currency,
       COUNT(e.executedQuantity)AS trade_count,
       SUM(e.executedQuantity) AS total_quantity,
       SUM(e.executedQuantity * e.priceMinor *  p.contractMultiplier) AS gross_notional_minor
       FROM post_orders p 
       JOIN post_executions e
       ON p.orderId = e.orderId
       GROUP BY p.venue, p.currency
       ORDER BY p.venue`,
    )
    .all();

  return { post_orders, post_executions, inventoryFields, venue_fields };
}
