// Preload for hosting: makes a service listen on 127.0.0.1 only, so the host
// can't see it and routes public traffic to order-service alone.
// Used by `npm run start:hosted`. The services' own code is unchanged.
import net from "node:net";

const listen = net.Server.prototype.listen;

net.Server.prototype.listen = function (...args) {
  // listen(port) or listen(port, callback) gets a host added after the port
  if (typeof args[0] === "number" && typeof args[1] !== "string") {
    args.splice(1, 0, "127.0.0.1");
  }
  return listen.apply(this, args);
};
