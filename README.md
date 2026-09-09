# Order Management System

Read [ASSIGNMENT.md](ASSIGNMENT.md). It is the only document you need.

## Getting started

```bash
npm install
```

Node 22.5 or newer. The only dependency is Express; the databases use Node's own built-in SQLite, so there is nothing else to install.

## What is already here

```
scaffold/security-service/   reference data about securities   (given, port 4001)
scaffold/market-service/     a pretend exchange                (given, port 4002)
scaffold/queue/              the message queue                 (given)
data/securities.json         security-service's database
data/scenarios/              the two scenario files
expected/                    what your program's output must look like
test/                        the acceptance tests
out/                         everything your program writes
```

## What you write

```
src/order-service/server.js       port 4003
src/ledger-service/server.js      port 4004
src/driver/place-orders.js        reads a scenario and places the orders in it
src/ledger-service/report-cli.js  writes the report from the command line
```

Those four paths are fixed, because the tests and `package.json` refer to them by name. Everything behind them is yours: as many files as you like, named and arranged however you like.

## Running it

Four terminals, or one if you would rather background them:

```bash
npm run start:security
```

```bash
npm run start:market
```

```bash
npm run start:ledger
```

```bash
npm run start:order
```

Then place the warmup orders:

```bash
npm run place data/scenarios/warmup.json
```

And write the report:

```bash
npm run report
```

## The tests

```bash
npm test
```

They start all four services themselves, run your driver, wait for everything to settle, and compare what came out against `expected/`. They never import your code — only the three entry paths and the four ports are fixed.

Until you have written something they will tell you exactly which of the three files is missing. That is the expected starting point.

Start with the warmup fixture. `data/scenarios/main.json` has cancels, duplicate messages and a restart in the middle, and is not a good place to begin.

## Starting fresh

Everything your program writes lives in `out/`. Delete it and the next run starts from nothing:

```bash
rm -rf out
```

## When you are done

Fill in `NOTES.md`.
# -order-management-system-assignment
