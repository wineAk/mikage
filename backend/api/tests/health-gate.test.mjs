import assert from "node:assert/strict";
import test from "node:test";

process.env.PGHOST ??= "127.0.0.1";
process.env.PGUSER ??= "test";
process.env.PGPASSWORD ??= "test";
process.env.PGDATABASE ??= "test";
process.env.MIKAGE_API_BEARER_TOKEN ??= "test-health-bearer-token-dummy-value";
process.env.MIKAGE_ADMIN_ALLOWED_HOSTS ??= "admin.example.test";

const [{ createApp }, { pool }] = await Promise.all([
  import("../src/app.mjs"),
  import("../src/db.mjs"),
]);

test("health stays available before data verification while application routes remain gated", async () => {
  const originalQuery = pool.query.bind(pool);
  const queries = [];
  let databaseAvailable = true;
  pool.query = async (sql) => {
    queries.push(sql);
    if (sql === "SELECT 1") {
      if (!databaseAvailable) throw new Error("test database unavailable");
      return { rows: [{ "?column?": 1 }] };
    }
    if (sql.includes("SELECT data_verified FROM mikage.migration_state")) {
      return { rows: [{ data_verified: false }] };
    }
    throw new Error("unexpected query");
  };

  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });

    const data = await fetch(`${baseUrl}/v1/monitoring/targets`);
    assert.equal(data.status, 503);
    assert.deepEqual(await data.json(), { error: "移行データの照合が完了していません。" });
    assert.deepEqual(queries, ["SELECT 1", "SELECT data_verified FROM mikage.migration_state WHERE singleton = true"]);

    databaseAvailable = false;
    const degradedHealth = await fetch(`${baseUrl}/health`);
    assert.equal(degradedHealth.status, 503);
    assert.deepEqual(await degradedHealth.json(), { status: "degraded", error: "データベースに接続できません。" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    pool.query = originalQuery;
    await pool.end();
  }
});
