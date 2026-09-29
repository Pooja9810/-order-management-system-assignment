export const createOrderInMarket = async (marketRequest) => {
  const response = await fetch(`http://127.0.0.1:4002/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientOrderId: marketRequest.clientOrderId,
      symbol: marketRequest.symbol,
      venue: marketRequest.venue,
      currency: marketRequest.currency,
      side: marketRequest.side,
      quantity: marketRequest.quantity,
      orderType: marketRequest.orderType,
      limitPriceMinor: marketRequest.limitPriceMinor,
    }),
  });

  return await response.json();
};

export const cancelMarketOrder = async (marketOrderId) => {
  //delete request
  const response = await fetch(
    `http://127.0.0.1:4002/orders/${marketOrderId}`,
    {
      method: `DELETE`,
    },
  );

  return await response.json();
};
