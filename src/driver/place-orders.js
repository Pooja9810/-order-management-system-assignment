import { readFileSync } from "node:fs";
const scenarioPath = process.argv[2];
const scenario = JSON.parse(readFileSync(scenarioPath, "utf-8"));
console.log(scenario.actions);
