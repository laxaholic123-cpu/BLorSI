import app from "./app";
import { logger } from "./lib/logger";

// Replit always injected PORT, so the server used to refuse to start without
// it. Off Replit that is just friction — default to 3000 and let the
// environment override.
const rawPort = process.env["PORT"] ?? "3000";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
