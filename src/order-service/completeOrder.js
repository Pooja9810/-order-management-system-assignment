//complete order including executions as a response to GET/orders:orderId
export const orderResponse = (order, executions) => {
  //calculate filledQuantity

  let filledQuantity = 0;
  for (const e of executions) {
    filledQuantity += e.executedQuantity;
  }

  //calculate leavesQuantity

  const leavesQuantity = Math.max(0, order.quantity - filledQuantity);

  // calculate averagePriceMinor

  let totalValue = 0;
  let totalQuantity = 0;

  for (const e of executions) {
    totalQuantity += e.executedQuantity;
    totalValue += e.executedQuantity * e.priceMinor;
  }

  const averagePriceMinor =
    totalQuantity === 0 ? null : Math.round(totalValue / totalQuantity);

  //calculate grossNotionalMinor

  let grossNotionalMinor = 0;

  for (const e of executions) {
    grossNotionalMinor += e.executedQuantity * e.priceMinor;
  }
  grossNotionalMinor *= order.contractMultiplier;

  //assign status
  const getStatus = (order, filledQuantity) => {
    if (order.rejectReason !== null) return "REJECTED";
    else if (filledQuantity >= order.quantity) return "FILLED";
    else if (order.cancelOutcome === "CANCELLED") return "CANCELLED";
    else if (order.cancelRequestedAt !== null && order.cancelOutcome === null)
      return "PENDING_CANCEL";
    else if (filledQuantity > 0) return "PARTIALLY_FILLED";
    if (order.acceptedByMarket === 1) return "WORKING";
    if (order.marketOrderId !== null) return "PENDING_NEW";
    return "NEW";
  };

  const status = getStatus(order, filledQuantity);

  return {
    ...order,
    acceptedByMarket: order.acceptedByMarket === 1,
    cancelRequested: order.cancelRequestedAt !== null,
    postedToLedger: order.postedToLedger === 1,
    status,
    filledQuantity,
    leavesQuantity,
    averagePriceMinor,
    grossNotionalMinor,
    executions,
  };
};
