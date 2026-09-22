// import { fetchSecurityById } from "./securityHelper.js";

export const validateOrderRequest = (orderRequest) => {
  if (!validateClientOrderId(orderRequest)) {
    return { status: 400, error: "MISSING_CLIENT_ORDER_ID" };
  }
  if (!validateSide(orderRequest)) {
    return { status: 400, error: "INVALID_SIDE" };
  }
  if (!validateOrderType(orderRequest)) {
    return { status: 400, error: "INVALID_ORDER_TYPE" };
  }
  if (!validateQuantity(orderRequest)) {
    return { status: 400, error: "INVALID_QUANTITY" };
  }
  if (orderRequest.orderType === "LIMIT") {
    if (!missingLimitPriceMinor(orderRequest)) {
      return { status: 400, error: "MISSING_LIMIT_PRICE" };
    }
  } else if (orderRequest.orderType === "MARKET") {
    if (!unexpectedLimitPrice(orderRequest)) {
      return { status: 400, error: "UNEXPECTED_LIMIT_PRICE" };
    }
  }
  if (!missingSecurity(orderRequest)) {
    return { status: 400, error: "MISSING_SECURITY" };
  }
  if (!ambiguousSecurity(orderRequest)) {
    return { status: 400, error: "AMBIGUOUS_SECURITY" };
  }
  if (!validateVenue(orderRequest)) {
    return { status: 400, error: "UNEXPECTED_VENUE" };
  }
  //...if()
  //   if (!validateSymbol(orderResult)) {
  //     return { status: 404, error: "UNKNOWN_SYMBOL" };
  //   }
};
//1. Validating the clientOrderId
export const validateClientOrderId = (orderRequest) => {
  console.log("Checking client order Id: ", orderRequest.clientOrderId);
  const clientId = orderRequest.clientOrderId;

  //missing clientId
  if (!clientId || typeof clientId !== "string") {
    return false;
  }
  //clientId already present in db
  return true;
};
//2. Validating "side"
const validateSide = (orderRequest) => {
  console.log("Checking side:", orderRequest.side);
  let side = orderRequest.side;
  if (side === "BUY" || side === "SELL") {
    return true;
  } else {
    return false;
  }
};

//3. Validating "orderType"
const validateOrderType = (orderRequest) => {
  console.log("Checking orderType:", orderRequest.orderType);
  let orderType = orderRequest.orderType;
  if (orderType === "MARKET" || orderType === "LIMIT") {
    return true;
  } else {
    return false;
  }
};

//4. Validating "quantity"

const validateQuantity = (orderRequest) => {
  console.log("Checking quantity:", orderRequest.quantity);
  let quantity = orderRequest.quantity;
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return false;
  } else {
    return true;
  }
};

//5. Validating missing LimitPriceMinor
const missingLimitPriceMinor = (orderRequest) => {
  if (orderRequest.orderType === "LIMIT") {
    console.log(
      "Checking limitPriceMinor for orderType LIMIT:",
      orderRequest.limitPriceMinor,
    );
    if (
      !Number.isInteger(orderRequest.limitPriceMinor) ||
      orderRequest.limitPriceMinor <= 0
    ) {
      return false;
    } else {
      return true;
    }
  }
};

//6. Validating unexpectedLimitPrice
const unexpectedLimitPrice = (orderRequest) => {
  if (orderRequest.orderType === "MARKET") {
    console.log(
      "Checking limitPriceMinor for orderType MARKET:",
      orderRequest.limitPriceMinor,
    );
    if (typeof orderRequest.limitPriceMinor !== "undefined") {
      return false;
    } else {
      return true;
    }
  }
};

//7. Validating symbol and security
const missingSecurity = (orderRequest) => {
  console.log(
    "Checking if symbol or security is present:",
    orderRequest.symbol,
    orderRequest.securityId,
  );
  if (
    typeof orderRequest.securityId !== "undefined" ||
    typeof orderRequest.symbol !== "undefined"
  ) {
    return true;
  } else {
    return false;
  }
};

//8. Validating ambiguous security
const ambiguousSecurity = (orderRequest) => {
  console.log(
    "Checking if symbol and security both present:",
    orderRequest.symbol,
    orderRequest.securityId,
  );
  if (
    typeof orderRequest.securityId !== "undefined" &&
    typeof orderRequest.symbol !== "undefined"
  ) {
    return false;
  } else {
    return true;
  }
};

//9. unexpected venue
const validateVenue = (orderRequest) => {
  console.log(
    `Checking if venue present with securityID:${orderRequest.securityId}`,
    orderRequest.venue,
  );

  if (
    typeof orderRequest.securityId !== "undefined" &&
    typeof orderRequest.venue !== "undefined"
  ) {
    return false;
  } else {
    return true;
  }
};

// //11. unknown symbol
// const validateSymbol = (orderResult) => {
//   console.log(
//     `Checking if symbol is presnt in securities: ${orderResult.symbol}`,
//   );
// };
