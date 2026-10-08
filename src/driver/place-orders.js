import { readFileSync } from "node:fs";
import process from "node:process";

const scenarioPath = process.argv[2];
const scenario = JSON.parse(readFileSync(scenarioPath, "utf-8"));
console.log(scenario.actions);

for (const action of scenario.actions) {
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
      console.log("Server response:", responseData);
    } catch (error) {
      console.error("Failed to connect to the server", error);
    }
  }
  if (action.action === "cancel") {
    //workout in scenario
  }
}
