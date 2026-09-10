# Order Management System

An assignment in four processes, two databases, one queue and a report.

---

## 1. What you are building

Somebody wants to buy 100 shares. They send that wish to your program. Your program works out what it actually means — which listing, which exchange, which currency — passes it to the exchange, and then keeps track of what comes back: part of it traded, then some more, and when the pieces add up to the whole quantity the order is finished. Nothing tells you that last part. You work it out. When an order is finished your program hands it to a second program of yours, which keeps the permanent record and prints the reports.

Four services run at once:

| Service            | Port | Who writes it    | What it is                                                              |
| ------------------ | ---- | ---------------- | ----------------------------------------------------------------------- |
| security-service   | 4001 | **given to you** | Answers questions about securities. Read-only, backed by a JSON file.   |
| market-service     | 4002 | **given to you** | Pretends to be the exchanges. Takes orders and reports back on a queue. |
| **order-service**  | 4003 | **you**          | The front door. Takes orders from people, talks to the other three.     |
| **ledger-service** | 4004 | **you**          | The permanent record, and the reports.                                  |

You also write a small **driver** that reads a scenario file and places the orders in it, which is how the whole thing gets exercised.

You write four files, and whatever else you need behind them:

```
src/order-service/server.js      started by the tests
src/ledger-service/server.js     started by the tests
src/driver/place-orders.js       run by the tests
src/ledger-service/report-cli.js run by "npm run report"
```

Those four paths are fixed, because `package.json` and the tests refer to them by name. Everything else — how many modules, what they are called, how you divide the work up — is yours.

Every one of them is started with the project root as the working directory, and the paths in §5 are relative to it. Start a service from somewhere else and it will quietly use a different, empty queue file.

---

## 2. The one rule that matters

**Your program never does anything on its own.**

It sits there. Something arrives, it reacts, it goes back to sitting there. There are exactly four things that can arrive:

1. **An HTTP request** — somebody placing an order, asking about one, or cancelling one.
2. **A message on the queue** — the exchange saying what happened to an order.
3. **The report trigger** — a timer, an HTTP request, or a command.
4. **The service starting up** — which happens once, and twice if it is killed and restarted.

Nothing else. No order moves itself along, nothing times out, nothing is swept up in the background, nothing happens "when the exchange is ready" except in the form of a message arriving on the queue.

There are exactly **three** places where one arrival causes your program to do something you were not directly asked for, and all three are listed here so you never have to wonder whether there are others:

- **Applying a queue message** is followed by a check: if the order is _now_ finished and has at least one execution, it is sent to the ledger. Note the wording — it is not "the message that finishes it". Messages arrive in any order, so the message that finishes an order and the message that gives it its first execution may not be the same one, and may not arrive in that order. See §8.2 and §10.6.
- **The report trigger** causes two CSV files to be written. See §12.3.
- **Starting up** causes order-service to look for finished orders that never reached the ledger, and send them. See §10.6. It is the only thing that happens without something arriving from outside, and it exists only because the process can be killed halfway through sending one.

That is the complete list. If a rule is not written in §8, that arrival does not do it.

---

## 3. …and the one rule that makes it interesting

**Work the answer out. Do not keep it.**

Your order-service will want fields like `filledQuantity` and `averagePrice`. Do not create them. Keep the _executions_ — the individual pieces of trading the exchange reports — and add them up whenever somebody asks. (`status` is a special case, because people want to search by it. §11 says what to do about that, and the answer is still not "keep a running one".)

Here is why, using order 2 from the real scenario file. It is a buy of 300 MSFT. The exchange trades it in four pieces and publishes four messages:

| Message        | Quantity |
| -------------- | -------- |
| `EXEC-MKT-2-2` | 91       |
| `EXEC-MKT-2-3` | 113      |
| `EXEC-MKT-2-4` | 6        |
| `EXEC-MKT-2-5` | 90       |

91 + 113 + 6 + 90 = 300. The order is completely filled.

Now: **the queue delivers `EXEC-MKT-2-4` twice.** Not because anything went wrong — that is simply what this queue does, and what real ones do. If your code keeps the executions in an array and pushes each `FILL` onto it, order 2 ends up holding five executions, and your program reports that it bought **306** shares of MSFT. It did not. It bought 300.

That extra row does not stay put. It goes into the ledger with the rest, and out into the report, changing lines in files that never mention order 2 anywhere. And it is not the only one: three of the twenty-three trade messages in the main scenario are delivered twice, on orders 2, 3 and 5. Here is the whole of the damage:

| Report line                        | Correct              | With duplicates counted |
| ---------------------------------- | -------------------- | ----------------------- |
| `SEC-1002` buy / trades / gross    | 300 / 4 / 12600000   | 306 / 5 / 12852000      |
| `SEC-1003` buy / trades / gross    | 250 / 4 / 2762500    | 269 / 5 / 2972450       |
| `SEC-1005` buy / trades / gross    | 260 / 1 / 4030000    | 520 / 2 / 8060000       |
| `NASDAQ` trades / quantity / gross | 11 / 453 / 19647530  | 12 / 459 / 19899530     |
| `TSX` trades / quantity / gross    | 11 / 1210 / 10962500 | 13 / 1489 / 15202450    |

Look at the third row. Order 5 was a buy of 500 that traded 260 and was then cancelled. Count its one execution twice and the total becomes 520, which is more than 500 — so by §10.1 the order is no longer `CANCELLED`, it is `FILLED`, and its `leavesQuantity` drops from 240 to 0. **One message arriving twice does not merely inflate a number. It changes what happened to the order.**

Store the executions in a table keyed by `execId`, and the second copy of `EXEC-MKT-2-4` overwrites nothing, adds nothing and changes nothing. Ask "how much has traded?" by adding up that table, and the answer is 300 no matter how many times the message arrived or in what order.

You have now been told which three. You will not be told again for any other run, and the tests do not tell you either — the point is to write something for which it does not matter.

---

## 4. The words

Thirteen terms, plus a short note after them. Nothing else in this document assumes you know anything about trading, and no trading term is used below that this section has not covered.

| Word            | What it means here                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Security**    | A thing that can be traded. Identified by a `securityId` like `SEC-1003`.                                                            |
| **Symbol**      | The short name a security trades under, like `AAPL`. **Not unique** — see §4.1.                                                      |
| **Venue**       | The exchange a security trades on: `NYSE`, `NASDAQ` or `TSX`.                                                                        |
| **Side**        | `BUY` or `SELL`.                                                                                                                     |
| **Order**       | A request to buy or sell a quantity of one security.                                                                                 |
| **Order type**  | `MARKET` (trade at whatever the price is) or `LIMIT` (trade only at this price or better, so the order carries a `limitPriceMinor`). |
| **Execution**   | One piece of actual trading: an `executedQuantity` at a `priceMinor`. One order can produce several. Each has an `execId`.           |
| **Fill**        | Short for "an execution happened". An order is _filled_ when its executions add up to its whole quantity.                            |
| **Minor units** | Money as a whole number of the smallest unit — cents. `38500` means $385.00. There are no decimal numbers anywhere in this system.   |
| **Position**    | How much of a security is held: everything bought minus everything sold. It can be negative, which means more was sold than bought.  |
| **Notional**    | What trading was worth: quantity × price, and × the contract multiplier where there is one.                                          |
| **Listing**     | One security's entry at one venue. `SHOP` has two listings, and they are two securities.                                             |
| **Leaves**      | What is left of an order: the quantity asked for, minus the quantity traded so far.                                                  |

Two more words appear only in the option's record, and only because that record is real: an **option** is a security that covers a quantity of something else, a **contract** is one unit of it, and the something else is the **underlying**. Nothing in this assignment does anything with them beyond multiplying by `contractMultiplier`.

The status names in §10.1 are not defined anywhere else either — they mean exactly what their rule in §10.1 says and nothing more. `PENDING_NEW` is "sent to the exchange, nothing heard back". `WORKING` is "the exchange has it and is trying".

### 4.1 The one that catches people

A **symbol is not an identity**. `SHOP` is a security on TSX priced in Canadian dollars, _and_ a different security on NYSE priced in US dollars. They are `SEC-1003` and `SEC-1004`. They are not the same thing and their positions must never be added together.

The main scenario buys 250 of one and sells 150 of the other, and it names both of them by symbol rather than by id — so your program has to tell them apart itself, using `GET /search` and the venue. If anything downstream is then keyed by symbol, those two become one security holding 100 shares, and the report is wrong in a way that is very hard to see afterwards.

Key everything by `securityId`. §9.0 is how you get one.

### 4.2 The exchange has never heard of a securityId

market-service knows nothing about your system. It does not know what `SEC-1003` is, it has no idea what an order id of yours looks like. You give it a symbol, a venue, a currency, a side, a quantity and possibly a price. It gives you back an id of its own, `MKT-7`.

So there are three different ids for the same order, and you need all of them:

| Id              | Made by      | Looks like | Used for                                                       |
| --------------- | ------------ | ---------- | -------------------------------------------------------------- |
| `orderId`       | you          | `7`        | Everything inside your system. The ledger's key.               |
| `clientOrderId` | you          | `ORD-7`    | Given to the exchange so a retry cannot create a second order. |
| `marketOrderId` | the exchange | `MKT-7`    | What every queue message is labelled with.                     |

The `MKT-` numbers happen to line up with your order ids in the fixtures. Do not rely on that — look the order up by the id the message actually carries.

`clientOrderId`, though, must be **exactly** `ORD-` followed by the order id. That is not a formatting preference: the exchange decides what to do with an order by hashing the `clientOrderId` it was given, so a different id means different trading, and none of the expected results will match. Work it out from the order id; do not generate it.

---

## 5. Fixed numbers

Every setting your code needs. Apart from HTTP status codes and the rules in §9, no number should appear in your code that is not either here or read from a file. (market-service and the queue have two settings of their own, `MARKET_SEED` and `QUEUE_DUPLICATE_RATE`. The tests set them from the scenario file. Yours must not read them.)

| Name                     | Value                       | Where it comes from   |
| ------------------------ | --------------------------- | --------------------- |
| security-service port    | 4001                        | `SECURITY_PORT`       |
| market-service port      | 4002                        | `MARKET_PORT`         |
| order-service port       | 4003                        | `ORDER_PORT`          |
| ledger-service port      | 4004                        | `LEDGER_PORT`         |
| Queue file               | `out/queue.sqlite`          | `QUEUE_FILE`          |
| Queue name               | `market-updates`            | `QUEUE_NAME`          |
| Visibility timeout       | 3000 ms                     | `QUEUE_VISIBILITY_MS` |
| Report interval          | 5 minutes                   | `REPORT_INTERVAL_MS`  |
| Report directory         | `out/reports`               | `REPORT_DIR`          |
| order-service database   | `out/order-service.sqlite`  | `ORDER_DB`            |
| ledger-service database  | `out/ledger-service.sqlite` | `LEDGER_DB`           |
| security-service address | `http://127.0.0.1:4001`     | `SECURITY_URL`        |
| market-service address   | `http://127.0.0.1:4002`     | `MARKET_URL`          |
| order-service address    | `http://127.0.0.1:4003`     | `ORDER_URL`           |
| ledger-service address   | `http://127.0.0.1:4004`     | `LEDGER_URL`          |
| Sides                    | `BUY`, `SELL`               | —                     |
| Order types              | `MARKET`, `LIMIT`           | —                     |
| Venues                   | `NYSE`, `NASDAQ`, `TSX`     | —                     |

Read every one of them from `process.env` with the value above as the default. The tests set several of them; a hard-coded port will fail.

---

## 6. What you are given

### 6.1 security-service (port 4001)

| Request                   | Answer                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /info/:securityId`   | The security, or `404 {"error":"SECURITY_NOT_FOUND"}`                                                                                       |
| `GET /search?symbol=SHOP` | `{ symbol, count, results: [...] }` — every listing under that symbol, or `400 {"error":"MISSING_SYMBOL"}` if the query parameter is absent |

A security looks like this:

```json
{
  "securityId": "SEC-1007",
  "symbol": "AAPL 260116C250",
  "name": "AAPL Jan 2026 250 Call",
  "assetType": "OPTION",
  "venue": "NASDAQ",
  "currency": "USD",
  "status": "ACTIVE",
  "lotSize": 1,
  "tickSizeMinor": 5,
  "contractMultiplier": 100,
  "underlyingSymbol": "AAPL",
  "optionType": "CALL",
  "expiry": "2026-01-16",
  "strikeMinor": 25000
}
```

- `status` is `ACTIVE` or `HALTED`. A halted security cannot be ordered.
- `lotSize` — quantities must be a whole number of these. `ENB` has a lot size of 100, so 500 is fine and 150 is not.
- `tickSizeMinor` — limit prices must be a multiple of this. The option above moves in steps of 5, so 1250 is fine and 1234 is not.
- `contractMultiplier` — how many underlying units one unit of this security covers. `1` for shares, `100` for the option. It matters in §10.5 and §12.3.
- `underlyingSymbol`, `optionType`, `expiry`, `strikeMinor` appear only on securities whose `assetType` is `OPTION`. Nothing in this assignment uses them. They are there because that is what the record really holds, and a security you fetch will have fields you do not need.

There are eight securities in `data/securities.json`. Read it if you like; your program must ask the service, not the file.

### 6.2 market-service (port 4002)

| Request                         | Answer                                                                                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /orders`                  | `201 { marketOrderId, clientOrderId, duplicate: false }`, or `200` with `duplicate: true` if it has seen this `clientOrderId` before, or `400` if the request is malformed |
| `DELETE /orders/:marketOrderId` | `202 { marketOrderId, status: "CANCEL_PENDING" }`, or `404` if it has never heard of that id                                                                               |
| `GET /health`                   | it is up                                                                                                                                                                   |

The exchange checks what it is sent and answers `400` for a missing field, an unknown venue, a bad side, a bad order type, a quantity that is not a whole number above zero, or a limit order with no price. If you have done §9.1 properly you will never see one, so treat a `400` from here as a bug in your own code rather than something to handle gracefully.

The body of `POST /orders`:

```json
{
  "clientOrderId": "ORD-7",
  "symbol": "SHOP",
  "venue": "TSX",
  "currency": "CAD",
  "side": "BUY",
  "quantity": 250,
  "orderType": "LIMIT",
  "limitPriceMinor": 11050
}
```

`limitPriceMinor` only when `orderType` is `LIMIT`.

Two things to notice:

- **Sending the same `clientOrderId` twice does not create a second order.** You get `200` back with `duplicate: true` and the original `marketOrderId`. This is your safety net, and it only works if the same order always uses the same `clientOrderId` — which is why `clientOrderId` is `ORD-` plus your `orderId`, and why the order must be written to your database _before_ you call the exchange.
- **`DELETE` does not cancel anything.** It asks. The answer comes back on the queue, later, and may be no.

### 6.3 The queue

A message queue kept in a SQLite file. `scaffold/queue/index.js` has the whole thing; the part you use is:

```js
import { consume } from "../../scaffold/queue/index.js";

const consumer = consume({
  file: process.env.QUEUE_FILE ?? "out/queue.sqlite",
  name: "market-updates",
  visibilityTimeoutMs: 3000,
  async handler({ messageId, body, deliveryCount }) {
    // Deal with body. Return and it is acknowledged.
    // Throw and it goes back on the queue and will arrive again.
  },
});

consumer.start();
```

Four things are true of it, and your code has to survive all four:

1. **It is persisted.** Stop everything, start it again, the messages are still there.
2. **It is not ordered.** A message about the last piece of trading can arrive before the message saying the order was accepted.
3. **It delivers at least once.** Some messages are written twice. Some are delivered again because you did not finish with them in time.
4. **It can hand you a message about an order you have not finished writing down.** Throw, and it will come back.

### 6.4 The securities file and the scenarios

`data/securities.json` is security-service's database. `data/scenarios/` holds the two scenario files described next.

---

## 7. The scenario file

A scenario is a JSON file listing things to do, in order.

```json
{
  "name": "warmup",
  "marketSeed": "warmup-150",
  "queueDuplicateRate": 0,
  "actions": [
    {
      "ref": "o1",
      "action": "place",
      "securityId": "SEC-1001",
      "side": "BUY",
      "quantity": 100,
      "orderType": "LIMIT",
      "limitPriceMinor": 38500,
      "note": "..."
    },
    { "ref": "x1", "action": "cancel", "target": "o1", "note": "..." }
  ]
}
```

| Field                                              | Meaning                                                                                                                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ref`                                              | A label for this action, so a later `cancel` can point at it.                                                                                                                                 |
| `action`                                           | `place` or `cancel`.                                                                                                                                                                          |
| `target`                                           | On a `cancel`, the `ref` of the `place` it refers to.                                                                                                                                         |
| `securityId`                                       | On a `place`, the security by id.                                                                                                                                                             |
| `symbol`, `venue`                                  | On a `place`, the security by name. Some actions carry a symbol alone, some a symbol and a venue, and one carries a `securityId` **and** a `symbol` so that §9.1 rule 7 refuses it. See §9.0. |
| `side`, `quantity`, `orderType`, `limitPriceMinor` | The order itself.                                                                                                                                                                             |
| `note`                                             | A comment for a human. Your program ignores it.                                                                                                                                               |
| `marketSeed`, `queueDuplicateRate`                 | Settings for the tests. Your program ignores them.                                                                                                                                            |

Your driver reads the file and works through `actions` from top to bottom. It:

- sends `place` actions to `POST /orders` on your order-service, **forwarding exactly the fields the action carries** — `securityId`, `symbol`, `venue`, `side`, `quantity`, `orderType`, `limitPriceMinor` — and leaving out the ones it does not. Do not fill a missing one in, and do not drop one you were given. One action carries **both** `securityId` and `symbol` on purpose, so that it is refused; a driver that picks one and ignores the other turns it into a valid order, which shifts every order id after it and makes every expected result wrong,
- sends `cancel` actions to `DELETE /orders/{orderId}`, using the order id that came back when the `ref` in `target` was placed,
- **waits for each answer before sending the next request**,
- **keeps going when a request is refused.** Fourteen requests in the main scenario are supposed to be refused: thirteen `place` actions and one `cancel` (`x5`, asking again for a cancel that is already outstanding). That is not an error and it must not stop the run.

> **The waiting is not optional.** What the exchange does with an order depends on the order it receives them in. If you fire all the requests off at once with `Promise.all`, you will get a different day's trading every run and the tests will never pass twice. One at a time, in file order.

There are two scenarios:

| File                         | What is in it                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `data/scenarios/warmup.json` | Five orders. Four trade, one is refused by the exchange. No cancels, no duplicate messages, no restart. Get this passing first.                                                                                                                                                                                          |
| `data/scenarios/main.json`   | 33 actions: 14 orders that are created, 13 `place` requests that are refused, 6 cancels of which one is refused. About a quarter of the exchange's messages are written to the queue twice. The tests kill your order-service 400 ms after the last action, while trade messages are still arriving, and start it again. |

---

## 8. Every arrival, and exactly what it does

If it is not in this table, that arrival does not do it.

### 8.1 HTTP requests to order-service

| Arrival                     | What changes                                                                                                                                                                                                                                                         | What is sent back                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `POST /orders`              | Checks §9.1 in order. If any fails, **nothing changes at all** — no order, no id used up. Otherwise: an order is created with the next order id; the security's details are copied onto it; then the exchange is called and the `marketOrderId` it returns is saved. | `201` and the order, shaped as §12.1                                              |
| `GET /orders/:orderId`      | Nothing.                                                                                                                                                                                                                                                             | `200` and the order, or `404` `ORDER_NOT_FOUND` if there is no such order         |
| `GET /orders`               | Nothing.                                                                                                                                                                                                                                                             | `200 { "orders": [...] }`, ordered by `orderId`                                   |
| `GET /orders?status=FILLED` | No thing.                                                                                                                                                                                                                                                            | The same, narrowed to orders in that status. An unknown status is refused (§9.4). |
| `DELETE /orders/:orderId`   | Checks §9.2 in order. Otherwise: the exchange is asked to cancel, and the order is marked as having a cancel outstanding. **The order is not cancelled by this.**                                                                                                    | `202` and the order                                                               |
| `GET /health`               | Nothing.                                                                                                                                                                                                                                                             | `200 { "status": "UP" }`                                                          |

### 8.2 Messages from the queue

Every message carries `messageId`, `sequence`, `marketOrderId`, `clientOrderId`, `occurredAt` and `type`. Find the order by `marketOrderId`.

`sequence` counts the messages the exchange has _sent_ about that one order, starting at 1. It is not a delivery order and it does not count anything of yours. Because the first message about an order is normally `ACCEPTED`, the first execution usually carries `sequence` 2 — order 2's four executions are numbered 2, 3, 4 and 5. Sort executions by it; do not expect it to start at 1 or to have no gaps.

| `type`            | What changes                                                                                                             | Also carries                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `ACCEPTED`        | The order is marked as accepted by the exchange.                                                                         | —                                                                             |
| `FILL`            | An execution is recorded against the order. **If an execution with this `execId` is already recorded, nothing changes.** | `execId`, `lastQuantity`, `lastPriceMinor`, and `sequence` like every message |
| `REJECTED`        | The order's reject reason is set.                                                                                        | `reason`                                                                      |
| `CANCELLED`       | The order's cancel outcome is set to `CANCELLED`.                                                                        | —                                                                             |
| `CANCEL_REJECTED` | The order's cancel outcome is set to `REJECTED` and the reason is kept. **The order is not cancelled — it carries on.**  | `reason`                                                                      |

A `FILL` message and the execution you store from it do not use the same names. The message is the exchange's wording; the execution is yours, and §12.1 is what the tests read:

| Message field    | Execution field    |
| ---------------- | ------------------ |
| `execId`         | `execId`           |
| `sequence`       | `sequence`         |
| `lastQuantity`   | `executedQuantity` |
| `lastPriceMinor` | `priceMinor`       |
| `occurredAt`     | `occurredAt`       |

**The one automatic consequence.** After applying any of the above, if the order is now finished _and_ has at least one execution, it is sent to the ledger — once — as described in §10.6 and §12.2. Nothing else happens automatically.

If no order can be found for the `marketOrderId`, throw. The message will be delivered again, by which time your `POST /orders` will have finished writing the id down.

### 8.3 The report trigger

| Arrival                                   | What changes                                  |
| ----------------------------------------- | --------------------------------------------- |
| `POST /generate-report` on ledger-service | A report is written. See §12.3.               |
| The 5-minute timer                        | The same report is written, by the same code. |
| `npm run report`                          | The same again, from the command line.        |

---

## 9. When to refuse

Every refusal below answers with the status shown and a JSON body whose `error` is exactly the code shown:

```json
{ "error": "INVALID_SIDE", "message": "anything you like" }
```

The tests read `error`. `message` is yours and is never compared.

### 9.0 First, work out which security is meant

A request names its security in one of three ways, and picking the right one is the first real job order-service does.

| The request carries  | What to do                                                                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `securityId`         | Ask `GET /info/:securityId`. One answer or a 404.                                                                                                                                                                |
| `symbol` on its own  | Ask `GET /search?symbol=`. **One** result: that is the security. **None**: refuse. **More than one**: refuse — the symbol does not say which one is meant, and guessing is how the wrong exchange gets an order. |
| `symbol` and `venue` | Ask `GET /search?symbol=`, then keep the results whose `venue` matches. One left: that is it. None left: refuse.                                                                                                 |

`AAPL`, `MSFT`, `RY` and `ENB` are each listed once, so a symbol on its own is enough. `SHOP` is listed twice, so it never is. Whichever way the request arrived, what gets stored on the order is the `securityId` that came back — the rest of the system only ever deals in ids.

### 9.1 `POST /orders` on order-service

Checked in this order. The first one that fails is the one reported, and when one fails **no order is created and no order id is used up**.

| #   | Condition                                                                         | Status | `error`                  |
| --- | --------------------------------------------------------------------------------- | ------ | ------------------------ |
| 1   | `side` is not `BUY` or `SELL`                                                     | 400    | `INVALID_SIDE`           |
| 2   | `orderType` is not `MARKET` or `LIMIT`                                            | 400    | `INVALID_ORDER_TYPE`     |
| 3   | `quantity` is not a whole number above zero                                       | 400    | `INVALID_QUANTITY`       |
| 4   | `orderType` is `LIMIT` and there is no whole-number `limitPriceMinor`             | 400    | `MISSING_LIMIT_PRICE`    |
| 5   | `orderType` is `MARKET` and a `limitPriceMinor` was sent                          | 400    | `UNEXPECTED_LIMIT_PRICE` |
| 6   | neither `securityId` nor `symbol` was given                                       | 400    | `MISSING_SECURITY`       |
| 7   | both `securityId` and `symbol` were given                                         | 400    | `AMBIGUOUS_SECURITY`     |
| 8   | `securityId` was given together with a `venue`                                    | 400    | `UNEXPECTED_VENUE`       |
| 9   | `securityId` was given and security-service answers 404                           | 404    | `UNKNOWN_SECURITY`       |
| 10  | `symbol` was given and the search finds nothing                                   | 404    | `UNKNOWN_SYMBOL`         |
| 11  | `symbol` and `venue` were given and nothing is listed at that venue               | 404    | `SYMBOL_NOT_AT_VENUE`    |
| 12  | `symbol` alone was given and more than one security trades under it               | 422    | `AMBIGUOUS_SYMBOL`       |
| 13  | the security's `status` is not `ACTIVE`                                           | 422    | `SECURITY_NOT_TRADABLE`  |
| 14  | `quantity` is not a multiple of `lotSize`                                         | 422    | `INVALID_LOT_SIZE`       |
| 15  | `orderType` is `LIMIT` and `limitPriceMinor` is not a multiple of `tickSizeMinor` | 422    | `INVALID_PRICE_TICK`     |

The order matters: a `MARKET` order for an unknown security with a quantity of zero is `INVALID_QUANTITY`, because 3 comes before 9. Rules 1 to 8 can all be decided without asking anybody. Rules 9 to 15 need security-service.

Rule 9 and rules 10 to 12 can never both apply. Rule 7 has already established that a request names its security one way or the other, so a request carrying a `securityId` can only fail at 9, and a request carrying a `symbol` can only fail at 10, 11 or 12. Rules 13, 14 and 15 are reached either way, once there is a security to check.

If security-service or market-service cannot be reached, answer `502` with `SECURITY_SERVICE_UNAVAILABLE` or `MARKET_SERVICE_UNAVAILABLE`.

A `502` from market-service is the one case that behaves differently from the fifteen rules above. By then the order has already been written down — it has to be, so that its `clientOrderId` exists before the exchange is called — so **it keeps its order id**. It sits at `NEW` with no `marketOrderId`, and nothing will ever arrive for it. Sending it again later is safe, because the same `clientOrderId` cannot create a second order at the exchange. Neither fixture makes this happen, but §9.2 rule 4 exists for the orders it would leave behind.

### 9.2 `DELETE /orders/:orderId` on order-service

| #   | Condition                                                                                                              | Status | `error`                    |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------- |
| 1   | no order with that id                                                                                                  | 404    | `ORDER_NOT_FOUND`          |
| 2   | the order is already finished (§10.1)                                                                                  | 409    | `ORDER_NOT_ACTIVE`         |
| 3   | a cancel is already outstanding and unanswered                                                                         | 409    | `CANCEL_ALREADY_REQUESTED` |
| 4   | the exchange has not been told about the order yet — which can only happen after a `502` from market-service, see §9.1 | 409    | `ORDER_NOT_AT_MARKET`      |

### 9.3 Anything else, on either service

| Condition                                                                           | Status | `error`          |
| ----------------------------------------------------------------------------------- | ------ | ---------------- |
| `GET /orders?status=` with something that is not one of the eight statuses in §10.1 | 400    | `INVALID_STATUS` |
| a request body that is not valid JSON                                               | 400    | `MALFORMED_JSON` |
| a path that is not one of the routes in §12                                         | 404    | `NOT_FOUND`      |

The last two matter because Express answers with an HTML error page if you let it. Everything your services say should be JSON in the shape above, including the things you did not plan for.

### 9.4 `POST /post-order` on ledger-service

| #   | Condition                                                                                         | Status | `error`                       |
| --- | ------------------------------------------------------------------------------------------------- | ------ | ----------------------------- |
| 1   | `orderId` is not a whole number                                                                   | 400    | `INVALID_ORDER_ID`            |
| 2   | `executions` is missing, not an array, or empty                                                   | 400    | `NO_EXECUTIONS`               |
| 3   | any of `securityId`, `symbol`, `venue`, `currency`, `assetType`, `side`, `finalStatus` is missing | 400    | `MISSING_FIELD`               |
| 4   | `contractMultiplier` is not a whole number above zero                                             | 400    | `INVALID_CONTRACT_MULTIPLIER` |
| 5   | **this `orderId` is already in the ledger**                                                       | 409    | `ORDER_ALREADY_POSTED`        |

Rule 5 is the important one. The ledger does not merge, does not update and does not quietly ignore. It refuses, and **nothing it already holds changes**, even if the second version says something completely different. The tests post a tampered copy of a real order and check that the ledger still says what it said before.

The other side of that rule is in §10.6: because a second post is refused, an order must be posted exactly once, when it is finished and not before.

---

## 10. The answers you work out

None of these is stored. Each is computed from the order and its executions whenever it is asked for.

### 10.1 `status`

Checked in this order — the **first** match wins:

| #   | If                                          | Then `status` is   |
| --- | ------------------------------------------- | ------------------ |
| 1   | a reject reason has been set                | `REJECTED`         |
| 2   | filled quantity ≥ ordered quantity          | `FILLED`           |
| 3   | the cancel outcome is `CANCELLED`           | `CANCELLED`        |
| 4   | a cancel is outstanding with no outcome yet | `PENDING_CANCEL`   |
| 5   | filled quantity is above zero               | `PARTIALLY_FILLED` |
| 6   | an `ACCEPTED` message has arrived           | `WORKING`          |
| 7   | a `marketOrderId` has been saved            | `PENDING_NEW`      |
| 8   | otherwise                                   | `NEW`              |

An order is **finished** when its status is `REJECTED`, `FILLED` or `CANCELLED`.

You never have to _guard_ against a finished order changing. Because the status is worked out by the precedence above, a late message cannot move a finished order backwards on its own. **So do not ignore messages that arrive for a finished order — keep recording what they say.** Order 3 is exactly this case: it is already `FILLED`, and already in the ledger, when its `CANCEL_REJECTED` arrives. Ignore that message and its `cancelOutcome` and `cancelRejectReason` stay `null`, which is wrong. Record it, and the status stays `FILLED` anyway, because rule 2 is reached before any cancel rule.

This ordering is what makes the answer independent of which message arrived first, and it is why the last message about an order does not decide its state. Worked example, order 3 of the main scenario: a cancel is asked for, the exchange refuses it (`CANCEL_REJECTED`, reason `ALREADY_FILLED`), and the order finishes fully traded. Its cancel outcome is `REJECTED`, and rule 2 fires before any cancel rule is reached, so its status is `FILLED` — and because it traded, it belongs in the ledger. **Asking to cancel an order does not stop it trading.**

### 10.2 `filledQuantity`

The sum of `executedQuantity` over the order's executions. Order 2: 91 + 113 + 6 + 90 = **300**.

### 10.3 `leavesQuantity`

`quantity − filledQuantity`, and never below zero. Order 5 of the main scenario was a buy of 500 of which 260 traded before it was cancelled, so its `leavesQuantity` is **240**.

### 10.4 `averagePriceMinor`

The quantity-weighted average price, rounded to the nearest whole minor unit, half up. `null` when nothing has traded.

Worked example, order 1 of the main scenario — a market order, so each piece traded at a different price:

```
71 at 38530  ->  2735630
29 at 38860  ->  1126940
                 -------
100                3862570

3862570 / 100 = 38625.7  ->  38626
```

Not 38695, which is what you get by averaging 38530 and 38860 and forgetting that the pieces were different sizes.

### 10.5 `grossNotionalMinor`

`sum of (executedQuantity × priceMinor)` over the executions, **multiplied by the security's `contractMultiplier`**. For shares the multiplier is 1 and it makes no difference. For order 13 — 3 option contracts at 1300, multiplier 100 — it is 3 × 1300 × 100 = **390000**.

### 10.6 Whether it belongs in the ledger

An order is sent to the ledger when **both** are true:

- it is finished (§10.1), and
- it has at least one execution.

Once, ever. Write down that it has been sent, and never send it again.

This is not the same as "filled", and the difference is the point:

| Order in the main scenario             | Status      | Filled | In the ledger?                          |
| -------------------------------------- | ----------- | ------ | --------------------------------------- |
| 4 — cancelled, never traded            | `CANCELLED` | 0      | **no** — there is nothing to record     |
| 5 — cancelled after part of it traded  | `CANCELLED` | 260    | **yes** — 260 shares really were bought |
| 3 — cancel refused, traded in full     | `FILLED`    | 250    | **yes**                                 |
| 11 — refused by the exchange           | `REJECTED`  | 0      | **no**                                  |
| 13 — cancelled after part of it traded | `CANCELLED` | 3      | **yes**                                 |

Send only the filled ones and you lose 260 shares of `RY` and 3 option contracts. Send everything that finished and the ledger refuses the empty ones with `NO_EXECUTIONS`.

**Getting it there exactly once, across a restart.** The ledger call can fail after the ledger has already recorded the order — the process can die between the write and your note that it was written. So:

- A `409 ORDER_ALREADY_POSTED` means **the ledger has it**. That is a success, not a failure. Mark the order as posted and stop.
- On startup, look for finished orders with executions that have not been posted, and post them. Orders already marked as posted are skipped, so this is safe to run every time.
- Post from **inside** the queue handler, and `await` it. If the ledger cannot be reached, let the handler throw: the message goes back on the queue and you get another go. Firing the request off without waiting means a failed post is lost silently, and the order never reaches the ledger at all.

---

## 11. One class, written out

This is the shape of the thing. Yours does not have to look like this, but whatever you build has to answer the same questions the same way.

```js
export class Order {
  #executions = new Map(); // execId -> Execution

  constructor({
    orderId,
    security,
    side,
    quantity,
    orderType,
    limitPriceMinor,
    createdAt,
  }) {
    this.orderId = orderId;
    this.security = security; // the whole security, as security-service gave it
    this.side = side;
    this.quantity = quantity;
    this.orderType = orderType;
    this.limitPriceMinor = limitPriceMinor ?? null;
    this.createdAt = createdAt;

    // Things that happened, recorded as they arrive.
    this.marketOrderId = null;
    this.acceptedByMarket = false;
    this.rejectReason = null;
    this.cancelRequestedAt = null;
    this.cancelOutcome = null; // null | 'CANCELLED' | 'REJECTED'
    this.cancelRejectReason = null;
    this.postedToLedgerAt = null;
  }

  get clientOrderId() {
    return `ORD-${this.orderId}`;
  }

  /** The same execution arriving twice changes nothing. */
  addExecution(execution) {
    if (this.#executions.has(execution.execId)) return false;
    this.#executions.set(execution.execId, execution);
    return true;
  }

  get executions() {
    return [...this.#executions.values()].sort(
      (a, b) => a.sequence - b.sequence,
    );
  }

  get filledQuantity() {
    return this.executions.reduce((total, e) => total + e.executedQuantity, 0);
  }

  get leavesQuantity() {
    return Math.max(0, this.quantity - this.filledQuantity);
  }

  get averagePriceMinor() {
    const filled = this.filledQuantity;
    if (filled === 0) return null;
    const value = this.executions.reduce(
      (t, e) => t + e.executedQuantity * e.priceMinor,
      0,
    );
    return Math.round(value / filled);
  }

  get status() {
    if (this.rejectReason !== null) return "REJECTED";
    if (this.filledQuantity >= this.quantity) return "FILLED";
    if (this.cancelOutcome === "CANCELLED") return "CANCELLED";
    if (this.cancelRequestedAt !== null && this.cancelOutcome === null)
      return "PENDING_CANCEL";
    if (this.filledQuantity > 0) return "PARTIALLY_FILLED";
    if (this.acceptedByMarket) return "WORKING";
    if (this.marketOrderId !== null) return "PENDING_NEW";
    return "NEW";
  }

  get isTerminal() {
    return ["REJECTED", "FILLED", "CANCELLED"].includes(this.status);
  }

  get belongsInLedger() {
    return this.isTerminal && this.filledQuantity > 0;
  }
}
```

### What it deliberately does not have

There is no `status` field, no `filledQuantity` field, no `averagePrice` field, no `leavesQuantity` field. Every one of those is a `get`, worked out from the executions at the moment it is asked for. The fields that do exist are all things that _happened_ and were recorded once: the exchange accepted it, the exchange rejected it with this reason, a cancel was asked for at this time.

The executions live in a `Map` keyed by `execId` rather than an array, for one reason: `addExecution` has to be safe to call twice with the same execution, because the queue will hand you the same execution twice.

**And this object is not where the order lives.** It is what one order looks like after it has been read out of the database. order-service keeps nothing between one request and the next: every request and every queue message loads the order and its executions from SQLite, works, and lets the object go. Assume the process is killed without warning at the worst possible moment — the tests do exactly that — and anything held only in a variable is gone.

### The structural rule you are marked on

**Not a field in the class, and not a column in the table.**

The same rule, both sides of the database. Store the order as it was asked for, and store the executions. The filled quantity, the leaves quantity, the average price and the notional are not stored in either place — each one is a question you answer by looking at the executions, in JavaScript or with `SUM` and `GROUP BY` in SQL, whichever suits the caller.

### The one exception, and its condition

People want to ask "which of my orders are still working?" without reading every order. That is a `WHERE` clause, and a `WHERE` clause needs a column. So **you may keep the status in a column** — and `GET /orders?status=WORKING` is what it is for.

It is a copy, not the truth. Two conditions come with it:

1. **Rewrite it from the executions every time anything about the order changes**, using the same §10.1 rules that answer `GET /orders`. Write it in the same operation that made the change, so the two can never disagree.
2. **Never set it from the message that just arrived.** Messages come in any order. The last message to land tells you nothing about where the order ended up — order 5's `CANCELLED` and its `FILL` can arrive either way round, and only one of those answers is right.

The tests check the copy against the truth from both directions: every order's reported status has to be the one §10.1's rules give for its own executions, and `?status=X` has to return exactly the orders that report `X`. A column maintained by hand fails one or the other.

This is worth understanding beyond this assignment. A derived value in a column is a cache, and a cache is only ever safe when something recomputes it from the source. The moment you maintain it incrementally, you have two answers to the same question and no way to tell which is wrong.

---

## 12. What your program must write

### 12.1 `GET /orders` on order-service

`{ "orders": [ ... ] }`, ordered by `orderId` ascending. Each order:

| Field                | Type           | What it is                                                                 |
| -------------------- | -------------- | -------------------------------------------------------------------------- |
| `orderId`            | number         | Whole numbers counting up from 1. A refused request never uses one.        |
| `clientOrderId`      | string         | `ORD-` + `orderId`                                                         |
| `marketOrderId`      | string \| null | What the exchange called it; null until it has been told                   |
| `securityId`         | string         | Whichever security §9.0 settled on — not necessarily what the request said |
| `symbol`             | string         | From security-service                                                      |
| `venue`              | string         | From security-service                                                      |
| `currency`           | string         | From security-service                                                      |
| `assetType`          | string         | From security-service                                                      |
| `contractMultiplier` | number         | From security-service                                                      |
| `side`               | string         | From the request                                                           |
| `quantity`           | number         | From the request                                                           |
| `orderType`          | string         | From the request                                                           |
| `limitPriceMinor`    | number \| null | From the request; null for market orders                                   |
| `status`             | string         | §10.1                                                                      |
| `filledQuantity`     | number         | §10.2                                                                      |
| `leavesQuantity`     | number         | §10.3                                                                      |
| `averagePriceMinor`  | number \| null | §10.4                                                                      |
| `grossNotionalMinor` | number         | §10.5                                                                      |
| `rejectReason`       | string \| null | From the `REJECTED` message                                                |
| `cancelRequested`    | boolean        | Whether a `DELETE` was accepted for this order                             |
| `cancelOutcome`      | string \| null | `CANCELLED`, `REJECTED`, or null if no answer yet                          |
| `cancelRejectReason` | string \| null | From the `CANCEL_REJECTED` message                                         |
| `postedToLedger`     | boolean        | Whether the ledger has been told                                           |
| `createdAt`          | string         | ISO timestamp                                                              |
| `executions`         | array          | Ordered by `sequence` ascending                                            |

Each execution: `execId`, `sequence`, `executedQuantity`, `priceMinor`, `occurredAt`.

`GET /orders/:orderId` returns one of these objects on its own, not wrapped, or `404` `ORDER_NOT_FOUND`.

`GET /orders?status=WORKING` returns the same `{ "orders": [...] }` shape, narrowed to the orders in that status and still ordered by `orderId`. The eight statuses are the ones in §10.1; anything else is `400` `INVALID_STATUS`.

The tests replace `createdAt` and `occurredAt` with a placeholder before comparing, so their actual values do not matter. Everything else is compared exactly.

### 12.2 ledger-service

**`POST /post-order`** takes:

```json
{
  "orderId": 5,
  "securityId": "SEC-1005",
  "symbol": "RY",
  "venue": "TSX",
  "currency": "CAD",
  "assetType": "STOCK",
  "contractMultiplier": 1,
  "side": "BUY",
  "finalStatus": "CANCELLED",
  "executions": [
    {
      "execId": "EXEC-MKT-5-2",
      "executedQuantity": 260,
      "priceMinor": 15500,
      "occurredAt": "2026-09-04T12:00:00.000Z"
    }
  ]
}
```

and answers `201 { orderId, postedAt, tradeCount }`, or one of §9.4. `finalStatus` is the order's `status` at the moment it is posted, which by §10.6 is always `FILLED` or `CANCELLED`. `tradeCount` is how many executions were recorded — a number here, unlike `trades` in `GET /posted-orders`, which is a list.

**`GET /health`** answers `200 { "status": "UP" }`, exactly as order-service does. The tests wait for this before they start anything else, so a ledger-service without it means nothing runs at all.

**`GET /posted-orders`** returns `{ "postedOrders": [ ... ] }`, ordered by `orderId`, each with `orderId`, `securityId`, `symbol`, `venue`, `currency`, `assetType`, `contractMultiplier`, `side`, `finalStatus`, `postedAt`, and `trades` — ordered by `execId`, each with `execId`, `executedQuantity`, `priceMinor`, `occurredAt`.

As in §12.1, the tests replace `postedAt` and `occurredAt` with a placeholder before comparing, so their actual values do not matter. Everything else is compared exactly.

**`POST /generate-report`** writes the report and answers `201 { reportId, inventoryFile, venuesFile, securities, venues }`.

### 12.3 The report

Two CSV files in `out/reports/`, numbered by how many reports have been generated — the first is `inventory-1.csv` and `venues-1.csv`, the second is `inventory-2.csv` and `venues-2.csv`, and so on. The numbering is kept in the ledger's own database and survives a restart.

Both files: a header row, then rows, comma separated, `\n` line endings, and a final newline. No quoting is needed — nothing in the data contains a comma.

**`inventory-N.csv`** — the position in each security that has traded, one row each, ordered by `security_id`:

| Column                 | What it is                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `security_id`          |                                                                                                            |
| `symbol`               |                                                                                                            |
| `asset_type`           |                                                                                                            |
| `venue`                |                                                                                                            |
| `currency`             |                                                                                                            |
| `contract_multiplier`  |                                                                                                            |
| `buy_quantity`         | Total `executedQuantity` across executions of orders whose side was `BUY`                                  |
| `sell_quantity`        | The same for `SELL`                                                                                        |
| `net_quantity`         | `buy_quantity − sell_quantity`. Can be negative.                                                           |
| `net_units`            | `net_quantity × contract_multiplier`                                                                       |
| `trade_count`          | How many executions, **not** how many orders                                                               |
| `gross_notional_minor` | `sum of (executedQuantity × price_minor × contract_multiplier)` over every execution, buys and sells alike |

The real first three rows, from `expected/main/inventory.csv`:

```
security_id,symbol,asset_type,venue,currency,contract_multiplier,buy_quantity,sell_quantity,net_quantity,net_units,trade_count,gross_notional_minor
SEC-1001,AAPL,STOCK,NASDAQ,USD,1,100,40,60,60,5,5407530
SEC-1002,MSFT,STOCK,NASDAQ,USD,1,300,0,300,300,4,12600000
SEC-1003,SHOP,STOCK,TSX,CAD,1,250,0,250,250,4,2762500
```

and the option row, where the multiplier shows up:

```
SEC-1007,AAPL 260116C250,OPTION,NASDAQ,USD,100,10,3,7,700,2,1640000
```

10 contracts bought, 3 sold, 7 net, covering 700 underlying units. The notional is 10 × 1250 × 100 plus 3 × 1300 × 100 = 1640000.

**`venues-N.csv`** — one row per venue and currency, ordered by venue:

| Column                 | What it is                                                      |
| ---------------------- | --------------------------------------------------------------- |
| `venue`                |                                                                 |
| `currency`             |                                                                 |
| `trade_count`          | Executions at that venue                                        |
| `total_quantity`       | Sum of `executedQuantity` over executions, buys and sells alike |
| `gross_notional_minor` | As above                                                        |

The whole of `expected/main/venues.csv`:

```
venue,currency,trade_count,total_quantity,gross_notional_minor
NASDAQ,USD,11,453,19647530
NYSE,USD,1,150,3605550
TSX,CAD,11,1210,10962500
```

**Every count in both files counts executions that were recorded in the ledger.** Orders that were refused, orders the exchange rejected, and orders cancelled before they traded are not in the ledger at all, so they are in neither file.

### 12.4 The log

Write whatever you find useful to a log file. Nothing compares it, and the wording is entirely yours.

---

## 13. How you are marked

| Weight  | What                                                                                                                                                                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **30%** | Orders and executions are modelled so that filled quantity, average price and notional are worked out rather than stored, and the status column — if you keep one — is recomputed rather than maintained. §3, §10, §11. |
| **25%** | The system survives duplicate messages, messages arriving in the wrong order, and order-service being killed and restarted mid-flight.                                                                                  |
| **15%** | Working out which security is meant (§9.0), and every refusal in §9, with the right status and the right `error`, and none of them creating an order.                                                                   |
| **15%** | The ledger: each order posted exactly once, a second post refused with 409 and changing nothing, an order and its trades written together or not at all.                                                                |
| **10%** | The report: right numbers, right columns, right order, numbered correctly.                                                                                                                                              |
| **5%**  | Migrations that run from empty and are never applied twice; a sensible layout; `NOTES.md`.                                                                                                                              |

The first two are more than half the marks. They are the same thing viewed from two sides: if the answers are worked out rather than stored, duplicates and restarts stop mattering almost by themselves.

---

## 14. Suggested order of work

Every step ends with something you can run and see.

1. `npm install`. Start security-service and market-service by hand and poke them with `curl`. Place an order directly on market-service, then ask it `GET /quiet` — it answers `{ quiet, busy, queueDepth }`, and `queueDepth` is how many messages are sitting on the queue waiting for somebody to read them. Watch that number go up.
2. An order-service that starts, listens on 4003 and answers `GET /health`.
3. Its database: a migration that creates the orders and executions tables, and a runner that applies migrations in filename order exactly once. The database is Node's own `node:sqlite` — `import { DatabaseSync } from 'node:sqlite'` — and `scaffold/queue/index.js` is a worked example of opening one and creating tables. Delete the file, start again, and check it rebuilds.
4. `POST /orders` that does the §9.1 checks and answers the §9.3 ones in JSON, works out which security is meant (§9.0 — both by id and by symbol, using `GET /search`), stores the order, and returns it. Do not call the exchange yet. Add `GET /orders` and `GET /orders/:orderId`.
5. All fifteen refusals. Try each one by hand — `SHOP` with no venue and `SHOP` with one are the two worth checking first.
6. Call market-service and save the `marketOrderId`.
7. Start consuming the queue: handle `ACCEPTED` and `FILL`. Work out `status`, `filledQuantity`, `leavesQuantity` and `averagePriceMinor` from the executions. Place an order and watch it fill.
8. `DELETE /orders/:orderId` and its four refusals. It only asks; nothing is cancelled yet.
9. Handle `REJECTED`, `CANCELLED` and `CANCEL_REJECTED` — now that step 8 exists you can provoke the last two.
10. The status column: a second migration that adds it, rewritten from the executions every time anything changes, and `GET /orders?status=`. See §11. Worth doing now rather than earlier, because only now do orders move through more than one status.
11. The driver, and `npm run place data/scenarios/warmup.json`.
12. ledger-service: migrations, `POST /post-order` with all of §9.4, `GET /posted-orders` and `GET /health` — the tests wait for that last one before they start anything. Then make order-service post finished orders once, treating 409 as success, with the catch-up sweep on startup. **The warmup fixture's order and ledger comparisons now pass.** Its two report comparisons still fail, because there is no report yet.
13. The report: both CSV files, the endpoint, `npm run report`, and the five-minute timer sharing the same code. **`npm test` should now pass everything — warmup and main alike.**

`npm test` needs all three of the files it starts to exist before it will do anything at all, so from step 11 onwards it becomes useful. Before that, work by hand with `curl`.

### What finished looks like

Somebody asked to buy 100 shares, back in §1. By the end, order 1 has bought all 100 of them in two pieces at an average of 38626, and thirteen other orders have been through your system alongside it. Order 3 was asked to cancel and traded anyway. Order 4 was cancelled before it traded and is nowhere in the ledger. Order 5 was cancelled _and_ traded, and its 260 shares of RY are in the ledger where they belong. `SHOP` is two securities, +250 in Toronto and −150 in New York. Your order-service was killed halfway through and picked up where it left off. And `venues.csv` ends up saying, in three lines, everything that went through each exchange:

```
venue,currency,trade_count,total_quantity,gross_notional_minor
NASDAQ,USD,11,453,19647530
NYSE,USD,1,150,3605550
TSX,CAD,11,1210,10962500
```

If your program prints those three lines, it got everything else right too.

---

## 15. `NOTES.md`

Fill in `NOTES.md`. It is short on purpose:

- **How to run it** — every command, in the order someone else would need them.
- **How it is laid out** — what each file is for, in a sentence each.
- **Decisions** — anything you did that the next person would raise an eyebrow at, and why you did it.
- **Not finished** — what does not work, what you know is wrong, what you would do next. Being straight about this costs nothing and hiding it costs marks.
