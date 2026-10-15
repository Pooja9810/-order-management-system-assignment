import { readFileSync } from "node:fs";
import process from "node:process";
import readline from "node:readline/promises";

const scenarioPath = process.argv[2];
const scenario = JSON.parse(readFileSync(scenarioPath, "utf-8"));
// console.log(scenario.actions);

const placedOrders = {};

for (const action of scenario.actions) {
  console.log(`============= ${action.note} =============`);

  if (action.action === "place") {
    //for warmup

    const fields = [
      "clientOrderId",
      "securityId",
      "symbol",
      "venue",
      "side",
      "quantity",
      "orderType",
      "limitPriceMinor",
    ];
    const body = {};
    for (const field of fields) {
      if (action[field] !== undefined) {
        body[field] = action[field];
      }
    }
    console.log("Body:", body);
    try {
      const response = await fetch(`http://127.0.0.1:4003/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const responseData = await response.json();

      // {'o3': 123}
      placedOrders[action.ref] = responseData.orderId;

      console.log("Server response:", responseData);
    } catch (error) {
      console.error("Failed to connect to the server", error);
    }
  }
  if (action.action === "cancel") {
    //workout in scenario
    console.log("CANCELLATIONS IN SCENARIO.JSON", action);
    //delete request
    console.log(`Action: ${action.target}`);

    const response = await fetch(
      `http://127.0.0.1:4003/orders/${placedOrders[action.target]}`,
      {
        method: "DELETE",
      },
    );

    const responseData = await response.json();
    console.log("Server responses:", responseData);
  }

  // press enter to continue otherwise exit
  // const rl = readline.createInterface({
  //   input: process.stdin,
  //   output: process.stdout,
  // });

  // // const x = await rl.question("Press Enter to continue");
  // // if (x === "") {
  // //   rl.close();
  // // } else {
  // //   process.exit(0);
  // // }
}
