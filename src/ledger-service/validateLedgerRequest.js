export const validateLedgerRequest = (orderRequest, db) => {
  if (!validateOrderId(orderRequest)) {
    return { status: 400, error: "INVALID_ORDER_ID" };
  }
  if (!validateExecutions(orderRequest)) {
    return { status: 400, error: "NO_EXECUTIONS" };
  }
  if (!validateFields(orderRequest)) {
    return { status: 400, error: "MISSING_FIELD" };
  }
  if (!validateContractMultiplier(orderRequest)) {
    return { status: 400, error: "INVALID_CONTRACT_MULTIPLIER" };
  }
  if (!validateOrderIdInLedger(orderRequest, db)) {
    return { status: 409, error: "ORDER_ALREADY_POSTED" };
  }
};

export const validateOrderId = (orderRequest) => {
  console.log("Checking request order Id: ", orderRequest.orderId);
  const reqOrderId = orderRequest.orderId;
  if (!Number.isInteger(reqOrderId) || reqOrderId <= 0) {
    return false;
  } else return true;
};

export const validateExecutions = (orderRequest) => {
  console.log("Checking the execution:", orderRequest.executions);
  const reqExecutions = orderRequest.executions;

  //`executions` is missing, not an array, or empty
  if (
    !reqExecutions ||
    !Array.isArray(reqExecutions) ||
    reqExecutions.length === 0
  ) {
    return false;
  } else return true;
};

export const validateFields = (orderRequest) => {
  console.log("Checking all fields:");
  const requiredFields = [
    `securityId`,
    `symbol`,
    `venue`,
    `currency`,
    `assetType`,
    `side`,
    `finalStatus`,
  ];
  const hasMissingFields = requiredFields.some(
    (field) =>
      orderRequest[field] === undefined ||
      orderRequest[field] === null ||
      orderRequest[field] === "",
  );

  if (hasMissingFields) {
    return false;
  } else {
    return true;
  }
};

export const validateContractMultiplier = (orderRequest) => {
  console.log(
    "Checking contract multiplier :",
    orderRequest.contractMultiplier,
  );
  const contractMultiplier = orderRequest.contractMultiplier;

  if (!Number.isInteger(contractMultiplier) || contractMultiplier <= 0) {
    return false;
  } else return true;
};

export const validateOrderIdInLedger = (orderRequest, db) => {
  console.log(
    "Checking if orderId is already present in ledger:",
    orderRequest.orderId,
  );
  const existing = db
    .prepare("SELECT * FROM post_orders WHERE orderId = ?")
    .get(orderRequest.orderId);

  if (existing) {
    console.log(
      `Order ${orderRequest.orderId} is already present in the ledger`,
    );
    return false;
  } else return true;
};
