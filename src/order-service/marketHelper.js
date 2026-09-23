export const callMarketService = async (orderResult) => {
  //POST request
  const response = await fetch(`http://127.0.0.1:4002/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientOrderId: orderResult.clientOrderId,
      symbol: orderResult.symbol,
      venue: orderResult.venue,
      currency: orderResult.currency,
      side: orderResult.side,
      quantity: orderResult.quantity,
      orderType: orderResult.orderType,
      limitPriceMinor: orderResult.limitPriceMinor,
    }),
  });

  return await response.json();
};
