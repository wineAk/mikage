import assert from "node:assert/strict";
import http from "node:http";
import test, { after } from "node:test";

process.env.PGHOST = "127.0.0.1";
process.env.PGUSER = "test";
process.env.PGPASSWORD = "test";
process.env.PGDATABASE = "test";
process.env.MIKAGE_API_BEARER_TOKEN = "test-gateway-bearer-token-dummy-value";
process.env.MIKAGE_ADMIN_ALLOWED_HOSTS = "admin.example.test";
delete process.env.MIKAGE_GATEWAY_ALLOWED_HOSTS;

const [{ createApp }, { pool }, { gatewayRouteContracts }] = await Promise.all([
  import("../src/app.mjs"),
  import("../src/db.mjs"),
  import("../src/routes/gateway-contracts.mjs"),
]);
const { config } = await import("../src/config.mjs");

const originalPoolQuery = pool.query;
let isMigrationVerified = true;
pool.query = async (query) => {
  if (query === "SELECT 1") {
    return { rows: [{ "?column?": 1 }] };
  }
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

function requestRaw(requestPath, { method = "GET", body, host = "admin.example.test", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port: server.address().port,
      method,
      path: requestPath,
      headers: { Host: host, ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
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

test("Production・Stagingのどちらでも未認証のGateway requestは401になる", async () => {
  const originalBearer = config.bearerToken;
  try {
    for (const bearer of ["example-production-bearer", "example-staging-bearer"]) {
      config.bearerToken = bearer;
      const response = await requestRaw("/gw/view-targets");
      assert.equal(response.status, 401);
    }
  } finally {
    config.bearerToken = originalBearer;
  }
});

test("認証済みGateway requestは既存endpointの処理とqueryを再利用する", async () => {
  const targetResponse = await fetch(`${baseUrl}/gw/view-targets`, {
    headers: { Authorization: "Bearer test-gateway-bearer-token-dummy-value" },
  });
  assert.equal(targetResponse.status, 200);
  assert.deepEqual(await targetResponse.json(), {
    targets: [{ key: "sample-target", name: "Sample target" }],
  });

  const logResponse = await fetch(
    `${baseUrl}/gw/view-logs?keys=&start=2026-11-18T00%3A00%3A00.000Z&end=2026-11-18T01%3A00%3A00.000Z`,
    { headers: { Authorization: "Bearer test-gateway-bearer-token-dummy-value" } }
  );
  assert.equal(logResponse.status, 200);
  assert.deepEqual(await logResponse.json(), { data: [] });

  const reservationResponse = await fetch(`${baseUrl}/gw/watch-reservations`, {
    method: "POST",
    headers: {
      Authorization: "Bearer test-gateway-bearer-token-dummy-value",
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

test("Gateway Host未設定時はHostを判定せず、現在の挙動を維持する", async () => {
  assert.equal(config.allowedGatewayHosts, null);
  const response = await requestRaw("/gw/view-targets", {
    host: "unlisted.example.test",
    headers: { Authorization: "Bearer test-gateway-bearer-token-dummy-value" },
  });
  assert.equal(response.status, 200);
});

test("Gateway許可HostではGateway routeを受け付け、Host比較は大文字小文字を無視する", async () => {
  const originalHosts = config.allowedGatewayHosts;
  config.allowedGatewayHosts = new Set(["gateway.example.test"]);
  try {
    const response = await requestRaw("/gw/view-targets", {
      host: "GATEWAY.EXAMPLE.TEST",
      headers: { Authorization: "Bearer test-gateway-bearer-token-dummy-value" },
    });
    assert.equal(response.status, 200);
  } finally {
    config.allowedGatewayHosts = originalHosts;
  }
});

test("管理画面HostではGatewayを拒否し、Gateway Hostでは管理routeを拒否する", async () => {
  const originalHosts = config.allowedGatewayHosts;
  config.allowedGatewayHosts = new Set(["gateway.example.test"]);
  try {
    const adminHostGateway = await requestRaw("/gw/view-targets", {
      host: "admin.example.test",
      headers: { Authorization: "Bearer test-gateway-bearer-token-dummy-value" },
    });
    assert.equal(adminHostGateway.status, 404);

    for (const path of ["/admin", "/admin.js", "/v1/admin/targets"]) {
      const gatewayHostAdmin = await requestRaw(path, { host: "gateway.example.test" });
      assert.equal(gatewayHostAdmin.status, 404, path);
    }

    for (const host of ["admin.example.test", "gateway.example.test", "other.example.test"]) {
      const healthResponse = await requestRaw("/health", { host });
      assert.equal(healthResponse.status, 200, host);
    }
  } finally {
    config.allowedGatewayHosts = originalHosts;
  }
});

test("ProductionとStagingのBearerを分離し、token文字列でrouteを選ばない", async () => {
  const productionBearer = "example-production-bearer-dummy-value";
  const stagingBearer = "example-staging-bearer-dummy-value";
  const originalBearer = config.bearerToken;
  try {
    for (const { serviceName, acceptedBearer, rejectedBearer } of [
      { serviceName: "Production", acceptedBearer: productionBearer, rejectedBearer: stagingBearer },
      { serviceName: "Staging", acceptedBearer: stagingBearer, rejectedBearer: productionBearer },
    ]) {
      config.bearerToken = acceptedBearer;
      const acceptedResponse = await requestRaw("/gw/view-targets", {
        headers: { Authorization: `Bearer ${acceptedBearer}` },
      });
      assert.equal(acceptedResponse.status, 200, `${serviceName} must accept only its own bearer`);
      const rejectedResponse = await requestRaw("/gw/view-targets", {
        headers: { Authorization: `Bearer ${rejectedBearer}` },
      });
      assert.equal(rejectedResponse.status, 401, `${serviceName} must reject the other service bearer`);
    }
  } finally {
    config.bearerToken = originalBearer;
  }
});

test("Bearerは401応答にもerror logにも出さない", async () => {
  const errorCalls = [];
  const originalConsoleError = console.error;
  const originalBearer = config.bearerToken;
  console.error = (...arguments_) => errorCalls.push(arguments_.join(" "));
  try {
    for (const serviceBearer of ["example-production-bearer", "example-staging-bearer"]) {
      const attemptedBearer = `${serviceBearer}-invalid`;
      config.bearerToken = serviceBearer;
      const response = await requestRaw("/gw/view-targets", {
        headers: { Authorization: `Bearer ${attemptedBearer}` },
      });
      assert.equal(response.status, 401);
      assert.equal(response.body.includes(attemptedBearer), false);
      assert.equal(errorCalls.join(" ").includes(attemptedBearer), false);
    }
  } finally {
    config.bearerToken = originalBearer;
    console.error = originalConsoleError;
  }
});

test("未定義Gateway pathと誤methodはmigration gateより先に404になる", async () => {
  isMigrationVerified = false;
  const originalBearer = config.bearerToken;
  try {
    for (const bearer of ["example-production-bearer", "example-staging-bearer"]) {
      config.bearerToken = bearer;
      for (const [method, requestPath] of [
        ["GET", "/gw/unknown"],
        ["POST", "/gw/view-targets"],
        ["GET", "/gw/watch-results"],
        ["GET", "/gw/admin"],
        ["GET", "/gw/admin.js"],
        ["GET", "/gw/v1/admin/targets"],
        ["GET", "/gwharmless"],
        ["GET", "/%67wharmless"],
        ["GET", "/gw/..%2fadmin"],
        ["GET", "/gw/%2e%2e%2fadmin"],
        ["GET", "/gw/%2e%2e%2fv1%2fadmin%2ftargets"],
      ]) {
        const response = await requestRaw(requestPath, { method });
        assert.equal(response.status, 404, `${method} ${requestPath}`);
      }
    }
  } finally {
    isMigrationVerified = true;
    config.bearerToken = originalBearer;
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
    "/gw/..%2fadmin",
    "/gw/%2e%2e%2fadmin",
    "/gw/%2e%2e%2fv1%2fadmin%2ftargets",
    "/gw/%2e%2e/v1/admin/targets",
    "/%67w/%2e%2e/admin",
  ]) {
    const response = await requestRaw(requestPath);
    assert.equal(response.status, 404, requestPath);
  }
});

test("Gateway POST bodyは1MBを超えると413になる", async () => {
  const originalBearer = config.bearerToken;
  try {
    for (const bearer of ["example-production-bearer", "example-staging-bearer"]) {
      config.bearerToken = bearer;
      const response = await fetch(`${baseUrl}/gw/watch-results`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ payload: "x".repeat(1024 * 1024) }),
      });
      assert.equal(response.status, 413);
    }
  } finally {
    config.bearerToken = originalBearer;
  }
});
