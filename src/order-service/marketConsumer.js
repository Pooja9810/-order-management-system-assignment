import { consume } from "../../scaffold/queue/index.js";
import process from "node:process";
import {
  updateAcceptedByMarket,
  insertIntoExecutions,
  updateRejectReason,
  getOrderByMarketOrderId,
} from "./orderHelper.js";

//Using the message queue

export const startMarketConsumerService = (db) => {
  const consumer = consume({
    file: process.env.QUEUE_FILE ?? "out/queue.sqlite",
    name: "market-updates",
    visibilityTimeoutMs: 3000,
    async handler({ messageId, body, deliveryCount }) {
      console.log("Queue message received:", body);
      console.log("messageId:", messageId);
      console.log("Delivery count", deliveryCount);

      const order = getOrderByMarketOrderId(db, body.marketOrderId);
      //if order is falsy
      if (!order) {
        throw new Error(`Order not found : ${body.marketOrderId}`);
      }

      if (body.type === "ACCEPTED") {
        handleAccepted(db, body);
      } else if (body.type === "FILL") {
        handleFill(db, order, body);
      } else if (body.type === "REJECTED") {
        handleReject(db, body, order);
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
const handleAccepted = (db, body) => {
  updateAcceptedByMarket(db, body.marketOrderId);
};

//If the message received has type FILL
//we have to insert into exec table
const handleFill = (db, order, body) => {
  const fillType = insertIntoExecutions(db, order.orderId, body);

  if (!fillType) {
    throw new Error(`Error while insert into execution : ${order.orderId}`);
  }
};
//If the message received has type REJECTED
const handleReject = (db, body, order) => {
  updateRejectReason(db, body, order.orderId);
};
