export const postOrderToLedger = async (order, executions) => {
  const response = await fetch(`http://127.0.0.1:4004/post-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderId: order.orderId,
      securityId: order.securityId,
      symbol: order.symbol,
      venue: order.venue,
      currency: order.currency,
      assetType: order.assetType,
      contractMultiplier: order.contractMultiplier,
      side: order.side,
      finalStatus: order.status,
      // postedAt: new Date().toISOString(),
      // trades: executions,
      executions: executions,
    }),
  });

  console.log("\nLedger response:", response);
  return await response.json();
};
