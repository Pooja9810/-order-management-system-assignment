import { consume } from "../../scaffold/queue/index.js";
import { checkAndPostToLedger } from "./orderHelper.js";
import process from "node:process";
import {
  updateAcceptedByMarket,
  insertIntoExecutions,
  updateRejectReason,
  getOrderByMarketOrderId,
  updateCancelOutcomeToCancelled,
  updateCancelOutcomeToCancelRejected,
  refreshStatus,
} from "./orderHelper.js";

//Using the message queue

export const startMarketConsumerService = (db) => {
  console.log("STARTING MARKET CONSUMER");
  const consumer = consume({
    file: process.env.QUEUE_FILE ?? "out/queue.sqlite",
    name: "market-updates",
    visibilityTimeoutMs: 3000,
    async handler({ messageId, body, deliveryCount }) {
      // console.log("\n Queue message received:", body);
      // console.log("messageId:", messageId);
      // console.log("Delivery count", deliveryCount);

      console.log(
        `[${deliveryCount}] messageId: ${messageId} marketOrderId: ${body.marketOrderId} type: ${body.type} execId: ${body.execId}`,
      );

      const order = getOrderByMarketOrderId(db, body.marketOrderId);

      //if order is falsy
      if (!order) {
        throw new Error(`Order not found : ${body.marketOrderId}`);
      }

      if (body.type === "ACCEPTED") {
        handleAccepted(db, body, order);
      } else if (body.type === "FILL") {
        handleFill(db, body, order);
      } else if (body.type === "REJECTED") {
        handleReject(db, body, order);
      } else if (body.type === "CANCELLED") {
        handleCancel(db, body, order);
      } else if (body.type === "CANCEL_REJECTED") {
        handleCancelRejected(db, body, order);
      } else {
        console.log(
          `Unhandled type ${body.type} for marketOrderId=${body.marketOrderId}  | orderId=${order.orderId}`,
        );
      }
    },
  });
  consumer.start();
};
//If the message received has type accepted
const handleAccepted = (db, body, order) => {
  updateAcceptedByMarket(db, body.marketOrderId);
  refreshStatus(db, order);
  checkAndPostToLedger(db, order.orderId);
};

//If the message received has type FILL
//we have to insert into exec table
const handleFill = (db, body, order) => {
  const fillType = insertIntoExecutions(db, order.orderId, body);
  refreshStatus(db, order);
  checkAndPostToLedger(db, order.orderId);

  if (!fillType) {
    throw new Error(`Error while insert into execution : ${order.orderId}`);
  }
};
//If the message received has type REJECTED
const handleReject = (db, body, order) => {
  updateRejectReason(db, order.orderId, body.reason);
  //get order from db with rejectReason
  const dbOrderWithRejectReason = getOrderByMarketOrderId(
    db,
    body.marketOrderId,
  );
  //pass the order with the reject reason in the db
  refreshStatus(db, dbOrderWithRejectReason);
  checkAndPostToLedger(db, order.orderId);
};

//If msg received has type CANCELLED
const handleCancel = (db, body, order) => {
  updateCancelOutcomeToCancelled(db, body.marketOrderId);
  refreshStatus(db, order);
  checkAndPostToLedger(db, order.orderId);
};

//If msg received has type CANCEL_REJECTED
const handleCancelRejected = (db, body, order) => {
  updateCancelOutcomeToCancelRejected(db, body.marketOrderId, body.reason);
  refreshStatus(db, order);
  checkAndPostToLedger(db, order.orderId);
};
