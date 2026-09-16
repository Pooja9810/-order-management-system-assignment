import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import express from "express";
import { createOrder } from "./orderHelper.js";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS orders (
  orderId INTEGER PRIMARY KEY ,
  clientOrderId TEXT    NOT NULL UNIQUE,
    marketOrderId     TEXT,
    securityId  TEXT    NOT NULL,
    symbol TEXT NOT NULL,
    venue TEXT NOT NULL,
    currency TEXT NOT NULL,
    assetType TEXT NOT NULL,
    contractMultiplier INTEGER NOT NULL,
    side TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    orderType TEXT NOT NULL,
    limitPriceMinor INTEGER,
    acceptedByMarket BOOLEAN,
    cancelOutcome TEXT,
    cancelRequestedAt TEXT,
    rejectReason TEXT,
    cancelRejectReason TEXT,
    postedToLedger BOOLEAN,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS executions (
  execId TEXT NOT NULL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(order_id),
  sequence INTEGER NOT NULL,
  executedQuantity INTEGER NOT NULL,
  priceMinor INTEGER NOT NULL,
  occurredAt TEXT NOT NULL
  )



  `;

function openDb(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  return db;
}
//Calling openDb so that db gets created
const absoluteDbPath = join(
  import.meta.dirname,
  "..",
  "..",
  "out",
  "order-service.sqlite",
);
console.log(absoluteDbPath);
const db = openDb(absoluteDbPath);

//express file
//import express from "express";
const app = express();
const PORT = 4003;

//THIS helps express read json from request bodeis

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({
    status: "UP",
  });
});

//POST/orders
app.post("/orders", async (req, res) => {
  const body = req.body;
  console.log("Request body:", body);

  let security = null;

  //access security-service to get security id
  if (body.securityId) {
    const response = await fetch(
      `http://127.0.0.1:4001/info/${body.securityId}`,
    );

    if (response.status === 404) {
      return res
        .status(404)
        .json({ error: `Security id ${body.securityId} not found` });
    }
    const data = await response.json();
    security = data;
    console.log("Security data:", data);

    //Read symbol, and venue from req.body

    console.log(`${data.securityId},${data.symbol},${data.venue}`);
  } else if (body.symbol) {
    {
      const symData = await fetch(
        `http://127.0.0.1:4001/search?symbol=${body.symbol}`,
      );

      let reply = await symData.json();
      security = reply.results[0];
      console.log("Symbol data present in security", reply);

      // if one symbol found
      if (reply.count === 1) {
        console.log(`Symbol ${reply.symbol} is the security`);
      }
      //if none
      else if (reply.count === 0) {
        console.log(`Symbol ${reply.symbol} not found`);
      }
      //if more than 1 symbol. Match with venue
      else if (reply.count > 1) {
        console.log(
          `Symbol ${reply.symbol} appears more than once. Match with venue`,
        );

        const venueMatch = reply.results.filter(
          (item) => item.venue === body.venue,
        );
        console.log("Venue Match:", venueMatch);
        if (venueMatch.length === 1) {
          console.log("Both symbol and venue match", venueMatch[0]);
        } else {
          return res.status(404).json({
            error: `Symbol ${reply.symbol} not found on venue ${body.venue}`,
          });
        }
      }
    }
  }
  console.log("Final security:", security);
  res.status(201).json({ message: "received" });
});
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

//create an order inside the orders table
//createOrder(db);

/*Wegenerate the req body and give it some deeets.
we access the security service to gain info related to the securityId present in my request body.
Once i bring req body and securityId details together, I then put some fields toegther to create an order.
clientOrderId in my request body is randomly generated unique id.

when i send the req from postman, the createOrder function creates a new order in the orders table with a unique client id.

Before any order insertion we have to check three things:
1) if security id is present in sec table ,else  404.
2) if symbol is present else 404. If more than one then compare along with venue
3) if symbol and venue match done. else refuse
 First I got the req body and security details, now I just need to insert them into the orders table.*/

// app.listen(PORT, () => {
//   console.log(`Server running on http://localhost:${PORT}`);
// });
