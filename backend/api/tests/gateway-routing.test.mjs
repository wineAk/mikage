import assert from "node:assert/strict";
import http from "node:http";
import test, { after } from "node:test";

process.env.PGHOST = "127.0.0.1";
process.env.PGUSER = "test";
process.env.PGPASSWORD = "test";
process.env.PGDATABASE = "test";
process.env.MIKAGE_API_BEARER_TOKEN = "test-token";
process.env.MIKAGE_ADMIN_ALLOWED_HOSTS = "admin.example.test";

const [{ createApp }, { pool }, { gatewayRouteContracts }] = await Promise.all([
  import("../src/app.mjs"),
  import("../src/db.mjs"),
  import("../src/routes/gateway-contracts.mjs"),
]);

const originalPoolQuery = pool.query;
let isMigrationVerified = true;
pool.query = async (query) => {
  if (query.includes("SELECT data_verified FROM mikage.migration_state")) {
    return { rows: [{ data_verified: isMigrationVerified }] };
  }
  if (query.includes("SELECT key, name FROM mikage.targets ORDER BY key")) {
    return { rows: [{ key: "sample-target", name: "Sample target" }] };
  }
  if (query.includes("SELECT key FROM mikage.targets WHERE is_enabled = true ORDER BY key ASC")) {
    return { rows: [{ key: "sample-target" }] };
  }
  if (query.includes("SELECT mikage.reserve_watch_run")) {
    return { rows: [{ selected_keys: ["sample-target"] }], rowCount: 1 };
  }
  if (query.includes("SELECT key, name FROM mikage.targets WHERE key = ANY($1::text[])")) {
    return { rows: [{ key: "sample-target", name: "Sample target" }] };
  }
  if (query.includes("SELECT results FROM mikage.watch_result_batches WHERE slot_start = $1::timestamptz")) {
    return { rows: [] };
  }
  throw new Error("unexpected database query in Gateway route test");
};

const server = createApp().listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  pool.query = originalPoolQuery;
  await pool.end();
});

function requestRaw(requestPath, { method = "GET", body, host = "admin.example.test" } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port: server.address().port,
      method,
      path: requestPath,
      headers: { Host: host, ...(body ? { "Content-Type": "application/json" } : {}) },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.once("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

test("全11 Gateway routeは既存endpointのBearer認証を維持する", async () => {
  assert.equal(gatewayRouteContracts.length, 11);
  for (const { method, path } of gatewayRouteContracts) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {}),
    });
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test("未検証migration gateより前にGatewayの未認証requestを401で拒否する", async () => {
  isMigrationVerified = false;
  try {
    const response = await fetch(`${baseUrl}/gw/view-targets`);
    assert.equal(response.status, 401);
  } finally {
    isMigrationVerified = true;
  }
});

test("認証済みGateway requestは既存endpointの処理とqueryを再利用する", async () => {
  const targetResponse = await fetch(`${baseUrl}/gw/view-targets`, {
    headers: { Authorization: "Bearer test-token" },
  });
  assert.equal(targetResponse.status, 200);
  assert.deepEqual(await targetResponse.json(), {
    targets: [{ key: "sample-target", name: "Sample target" }],
  });

  const logResponse = await fetch(
    `${baseUrl}/gw/view-logs?keys=&start=2026-11-18T00%3A00%3A00.000Z&end=2026-11-18T01%3A00%3A00.000Z`,
    { headers: { Authorization: "Bearer test-token" } }
  );
  assert.equal(logResponse.status, 200);
  assert.deepEqual(await logResponse.json(), { data: [] });

  const reservationResponse = await fetch(`${baseUrl}/gw/watch-reservations`, {
    method: "POST",
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ slot_start: "2026-11-18T17:00:00.000Z", is_full_run: false }),
  });
  assert.equal(reservationResponse.status, 200);
  assert.deepEqual(await reservationResponse.json(), {
    slot_start: "2026-11-18T17:00:00.000Z",
    is_full_run: false,
    selected_target_keys: ["sample-target"],
    selected_target_names: { "sample-target": "Sample target" },
    saved_results: null,
    reserved: true,
    reason: "reserved",
  });
});

test("未定義Gateway pathと誤methodはmigration gateより先に404になる", async () => {
  isMigrationVerified = false;
  try {
    for (const [method, requestPath] of [
      ["GET", "/gw/unknown"],
      ["POST", "/gw/view-targets"],
      ["GET", "/gw/watch-results"],
      ["GET", "/gw/admin"],
      ["GET", "/gw/admin.js"],
      ["GET", "/gw/v1/admin/targets"],
      ["GET", "/gwharmless"],
      ["GET", "/%67wharmless"],
    ]) {
      const response = await requestRaw(requestPath, { method });
      assert.equal(response.status, 404, `${method} ${requestPath}`);
    }
  } finally {
    isMigrationVerified = true;
  }
  assert.equal((await requestRaw("/%67w/view-targets")).status, 404);
});

test("dot segmentとencoded dot segmentでGateway外のadmin routeへ到達しない", async () => {
  const adminResponse = await requestRaw("/admin");
  assert.equal(adminResponse.status, 200, "test host can reach the existing admin route directly");

  for (const requestPath of [
    "/gw/../admin",
    "/gw/%2e%2e/admin",
    "/gw/%2e%2e/v1/admin/targets",
    "/%67w/%2e%2e/admin",
  ]) {
    const response = await requestRaw(requestPath);
    assert.equal(response.status, 404, requestPath);
  }
});

test("Gateway POST bodyは1MBを超えると413になる", async () => {
  const response = await fetch(`${baseUrl}/gw/watch-results`, {
    method: "POST",
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payload: "x".repeat(1024 * 1024) }),
  });
  assert.equal(response.status, 413);
});
