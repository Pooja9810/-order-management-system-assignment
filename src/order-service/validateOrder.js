export const validateOrderRequest = (orderRequest) => {
  if (!validateClientOrderId(orderRequest)) {
    return { status: 400, error: "MISSING_CLIENT_ID" };
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
  //...
};
//Validating the clientOrderId
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
//Validating "side"
const validateSide = (orderRequest) => {
  console.log("Checking side:", orderRequest.side);
  let side = orderRequest.side;
  if (side === "BUY" || side === "SELL") {
    return true;
  } else {
    return false;
  }
};

//Validating "orderType"
const validateOrderType = (orderRequest) => {
  console.log("Checking orderType:", orderRequest.orderType);
  let orderType = orderRequest.orderType;
  if (orderType === "MARKET" || orderType === "LIMIT") {
    return true;
  } else {
    return false;
  }
};

//Validating "quantity"

const validateQuantity = (orderRequest) => {
  console.log("Checking quantity:", orderRequest.quantity);
  let quantity = orderRequest.quantity;
  if (quantity <= -1) {
    return false;
  } else {
    return true;
  }
};
