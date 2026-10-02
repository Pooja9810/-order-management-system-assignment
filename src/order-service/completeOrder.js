import { valid_status } from "./constants.js";
//complete order including executions as a response to GET/orders:orderId

export const orderResponse = (order, executions) => {
  try {
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
  } catch (error) {
    throw new Error("Error while generating complete order", { cause: error });
  }
};

//assign status
export const getStatus = (order, filledQuantity) => {
  if (order.rejectReason !== null) return valid_status.REJECTED;
  else if (filledQuantity >= order.quantity) return valid_status.FILLED;
  else if (order.cancelOutcome === "CANCELLED") return valid_status.CANCELLED;
  else if (order.cancelRequestedAt !== null && order.cancelOutcome === null)
    return valid_status.PENDING_CANCEL;
  else if (filledQuantity > 0) return valid_status.PARTIALLY_FILLED;
  if (order.acceptedByMarket === 1) return valid_status.WORKING;
  if (order.marketOrderId !== null) return valid_status.PENDING_NEW;
  return "NEW";
};
