import { createApp } from "./app.mjs";
import { config } from "./config.mjs";
import { pool } from "./db.mjs";

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`mikage monitoring api listening on port ${config.port}`);
});

function shutdown() {
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);