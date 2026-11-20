import pg from "pg";
import { config } from "./config.mjs";

export const pool = new pg.Pool({
  ...config.database,
  max: 10,
  connectionTimeoutMillis: 10_000,
});

export async function withClient(run) {
  const client = await pool.connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}
