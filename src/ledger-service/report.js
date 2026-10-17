import fs from "fs";

//extract details from post_orders and post_executions
export function generateReport(db) {
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


      COUNT(p.orderId) AS trade_count,
        
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

  //CSV Headers
  let inventory_headers = [
    "security_id",
    "symbol",
    "asset_type",
    "venue",
    "currency",
    "contract_multiplier",
    "buy_quantity",
    "sell_quantity",
    "net_quantity",
    "net_units",
    "trade_count",
    "gross_notional_minor",
  ];

  let venue_headers = [
    "venue",
    "currency",
    "trade_count",
    "total_quantity",
    "gross_notional_minor",
  ];

  //Get and increment report counter
  let counter = db
    .prepare("SELECT count FROM report_counter WHERE id = 1")
    .get();
  //first run
  if (!counter) {
    db.prepare("INSERT INTO report_counter (id, count) VALUES (1, 1)").run();
    counter = { count: 1 };
  } else {
    db.prepare(
      "UPDATE report_counter SET count = count + 1 WHERE id = 1",
    ).run();
    //increement counter
    counter = { count: counter.count + 1 };
  }

  const reportId = counter.count;

  let inventory_csv = [
    inventory_headers.join(","),
    ...inventoryFields.map((row) =>
      inventory_headers.map((field) => row[field] ?? "").join(","),
    ),
  ].join("\n");

  let venue_csv = [
    venue_headers.join(","),
    ...venue_fields.map((row) =>
      venue_headers.map((field) => row[field] ?? "").join(","),
    ),
  ].join("\n");

  fs.writeFileSync(
    `./out/reports/inventory-${reportId}.csv`,
    inventory_csv + "\n",
    "utf-8",
  );
  fs.writeFileSync(
    `out/reports/venues-${reportId}.csv`,
    venue_csv + "\n",
    "utf-8",
  );

  return {
    reportId,
    securities: inventoryFields.length,
    venues: venue_fields.length,
  };
}
