## About the project

1.  What it is:

I built an stock order management system. It takes orders from clients, validates them,send them to a mock exchange, tracks what happens and then generates reports. It has four microservices - order, ledger, security and market. Two were given to me and two i built from scratch.

2. What I built:

I built the order service and ledger service. The order service is a REST API which handles orders placement with sixteen validation rules, resolves securities through a lookup service, places orders on the exchange and consumes a queue to track order fills and cancellations. The ledger service persists completed orders and generates CSV reports

3.
