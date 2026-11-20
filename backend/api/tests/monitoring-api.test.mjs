import assert from "node:assert/strict";
import http from "node:http";
import test, { before } from "node:test";

import {
  assertTestDatabaseIsolated,
  authHeaders,
  createTestPool,
  resetMonitoringFixture,
  startTestServer,
} from "./helpers.mjs";

function fetchAdmin(baseUrl, path, init = {}) {
  const url = new URL(path, baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: url.hostname,
      port: Number(url.port),
      path: `${url.pathname}${url.search}`,
      method: init.method ?? "GET",
      headers: { ...init.headers, Host: "admin.example.test" },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: response.statusCode,
          headers: { get(name) { return response.headers[name.toLowerCase()] ?? null; } },
          async json() { return JSON.parse(body); },
          async text() { return body; },
        });
      });
    });
    request.once("error", reject);
    request.end(init.body);
  });
}

const databaseHost = process.env.PGHOST ?? "127.0.0.1";
const databaseUser = process.env.PGUSER ?? "test";
const databasePassword = process.env.PGPASSWORD ?? "test";
const databaseName = process.env.PGDATABASE ?? "test";
const apiBearerToken = process.env.MIKAGE_API_BEARER_TOKEN ?? "test-monitoring-bearer-token-dummy-value";
process.env.PGHOST ??= databaseHost;
process.env.PGUSER ??= databaseUser;
process.env.PGPASSWORD ??= databasePassword;
process.env.PGDATABASE ??= databaseName;
process.env.MIKAGE_API_BEARER_TOKEN ??= apiBearerToken;
process.env.MIKAGE_ADMIN_ALLOWED_HOSTS ??= "admin.example.test";
process.env.MIKAGE_TARGET_ALLOWED_HOSTS ??= "api.example.test";

const databaseConfigured = Boolean(process.env.TEST_PGHOST);
if (databaseConfigured) {
  assertTestDatabaseIsolated();
}

const [{ createApp }, { pool: apiPool }, { PREVIEW_ALLOWED_HOSTS }] = await Promise.all([
  import("../src/app.mjs"),
  import("../src/db.mjs"),
  import("../src/preview-target-hosts.mjs"),
]);

const bearerToken = apiBearerToken;

before(async () => {
  if (!databaseConfigured) return;
  assertTestDatabaseIsolated();
  const pool = await createTestPool();
  try {
    await pool.query(
      "UPDATE mikage.migration_state SET data_verified = true, verified_at = clock_timestamp() WHERE singleton = true"
    );
  } finally {
    await pool.end();
  }
});

test.after(async () => {
  await apiPool.end();
});

test("Bearer 未設定は 401", { skip: !databaseConfigured }, async () => {
  const { baseUrl, close } = await startTestServer(createApp);
  try {
    const response = await fetch(`${baseUrl}/v1/monitoring/targets`);
    assert.equal(response.status, 401);
    const resultResponse = await fetch(baseUrl + "/v1/watch/results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(resultResponse.status, 401);
  } finally {
    await close();
  }
});

test("監視結果の未知fieldと不正slotは400", { skip: !databaseConfigured }, async () => {
  const { baseUrl, close } = await startTestServer(createApp);
  try {
    for (const body of [
      { slot_start: "2026-11-16T12:00:00.000Z", ignored: true, results: [] },
      { slot_start: "2026-02-30T12:00:00.000Z", results: [] },
    ]) {
      const response = await fetch(baseUrl + "/v1/watch/results", {
        method: "POST",
        headers: { ...authHeaders(bearerToken), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
    }
  } finally {
    await close();
  }
});

test("移行データの照合前はhealth以外を503で閉じる", { skip: !databaseConfigured }, async () => {
  const pool = await createTestPool();
  await pool.query("UPDATE mikage.migration_state SET data_verified = false, verified_at = NULL WHERE singleton = true");
  const { baseUrl, close } = await startTestServer(createApp);
  try {
    const health = await fetch(`${baseUrl}/health`);
    const admin = await fetchAdmin(baseUrl, "/admin");
    const targets = await fetch(baseUrl + "/v1/monitoring/targets", { headers: authHeaders(bearerToken) });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
    assert.equal(admin.status, 503);
    assert.equal(targets.status, 503);
  } finally {
    await close();
    await pool.query("UPDATE mikage.migration_state SET data_verified = true, verified_at = clock_timestamp() WHERE singleton = true");
    await pool.end();
  }
});

test("monitoring target endpoint rejects any enabled URL outside the exact host allowlist", { skip: !databaseConfigured }, async () => {
  const pool = await createTestPool();
  const { baseUrl, close } = await startTestServer(createApp);
  try {
    await resetMonitoringFixture(pool);
    const unsafeUrl = "https://example.invalid.attacker.example/";
    await pool.query("UPDATE mikage.targets SET url=$1 WHERE key='t-alpha'", [unsafeUrl]);
    const response = await fetch(baseUrl + "/v1/monitoring/targets", { headers: authHeaders(bearerToken) });
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /example\.invalid/);

    await resetMonitoringFixture(pool);
    await pool.query("UPDATE mikage.targets SET headers='[\"invalid\"]'::jsonb WHERE key='t-alpha'");
    const invalidHeadersResponse = await fetch(baseUrl + "/v1/monitoring/targets", { headers: authHeaders(bearerToken) });
    assert.equal(invalidHeadersResponse.status, 503);
    assert.doesNotMatch(await invalidHeadersResponse.text(), /invalid/);

    await resetMonitoringFixture(pool);
    await pool.query("UPDATE mikage.targets SET url='https://not-allowed.invalid/' WHERE key='t-off'");
    const disabledTargetResponse = await fetch(baseUrl + "/v1/monitoring/targets", { headers: authHeaders(bearerToken) });
    assert.equal(disabledTargetResponse.status, 200);
    const enableInvalidTargetResponse = await fetchAdmin(baseUrl, "/v1/admin/targets/t-off/enabled", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_enabled: true }),
    });
    assert.equal(enableInvalidTargetResponse.status, 400);
    const stillDisabled = await pool.query("SELECT is_enabled FROM mikage.targets WHERE key='t-off'");
    assert.equal(stillDisabled.rows[0].is_enabled, false);
  } finally {
    await close();
    await pool.end();
  }
});

test("不正なBearer tokenは 401", { skip: !databaseConfigured }, async () => {
  const { baseUrl, close } = await startTestServer(createApp);
  try {
    const response = await fetch(`${baseUrl}/v1/monitoring/targets`, {
      headers: authHeaders("incorrect-token"),
    });
    assert.equal(response.status, 401);
  } finally {
    await close();
  }
});

test("UTC分境界以外または存在しないslotは 400", { skip: !databaseConfigured }, async () => {
  const { baseUrl, close } = await startTestServer(createApp);
  try {
    for (const slotStart of ["2026-11-16T01:00:01.000Z", "2026-02-30T01:00:00.000Z"]) {
      const response = await fetch(`${baseUrl}/v1/watch/reservations`, {
        method: "POST",
        headers: { ...authHeaders(bearerToken), "Content-Type": "application/json" },
        body: JSON.stringify({ slot_start: slotStart, is_full_run: false }),
      });
      assert.equal(response.status, 400);
    }
  } finally {
    await close();
  }
});

test("有効 target のみ返す", { skip: !databaseConfigured }, async () => {
  const pool = createTestPool();
  await resetMonitoringFixture(pool);

  const { baseUrl, close } = await startTestServer(createApp);
  try {
    const response = await fetch(`${baseUrl}/v1/monitoring/targets`, {
      headers: authHeaders(bearerToken),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(
      body.targets.map((target) => target.key),
      ["t-alpha", "t-beta"]
    );
  } finally {
    await close();
    await pool.end();
  }
});

test("同一slotの再予約は未完了の対象を返して再試行できる", { skip: !databaseConfigured }, async () => {
  const pool = createTestPool();
  await resetMonitoringFixture(pool);

  const slotStart = "2026-11-16T01:00:00.000Z";
  const { baseUrl, close } = await startTestServer(createApp);
  try {
    const first = await fetch(`${baseUrl}/v1/watch/reservations`, {
      method: "POST",
      headers: { ...authHeaders(bearerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ slot_start: slotStart, is_full_run: false }),
    });
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.reserved, true);
    assert.equal(firstBody.selected_target_keys.length, 1);

    const second = await fetch(`${baseUrl}/v1/watch/reservations`, {
      method: "POST",
      headers: { ...authHeaders(bearerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ slot_start: slotStart, is_full_run: false }),
    });
    const secondBody = await second.json();
    assert.equal(secondBody.reserved, true);
    assert.deepEqual(secondBody.selected_target_keys, firstBody.selected_target_keys);
    assert.equal(secondBody.reason, "reserved");
    assert.equal(secondBody.saved_results, null);
    assert.equal(typeof secondBody.selected_target_names[firstBody.selected_target_keys[0]], "string");
  } finally {
    await close();
    await pool.end();
  }
});

test("full run は有効 target をすべて予約", { skip: !databaseConfigured }, async () => {
  const pool = createTestPool();
  await resetMonitoringFixture(pool);

  const slotStart = "2026-11-16T02:00:00.000Z";
  const { baseUrl, close } = await startTestServer(createApp);
  try {
    const response = await fetch(`${baseUrl}/v1/watch/reservations`, {
      method: "POST",
      headers: { ...authHeaders(bearerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ slot_start: slotStart, is_full_run: true }),
    });
    const body = await response.json();
    assert.equal(body.reserved, true);
    assert.deepEqual(body.selected_target_keys.sort(), ["t-alpha", "t-beta"]);
  } finally {
    await close();
    await pool.end();
  }
});

test("輪番は最古の確認・予約を優先", { skip: !databaseConfigured }, async () => {
  const pool = createTestPool();
  await resetMonitoringFixture(pool);
  await pool.query(`
    INSERT INTO mikage.watch_target_states (target_key, last_checked_at, last_reserved_at)
    VALUES
      ('t-alpha', '2026-11-16T00:00:00.000Z', '2026-11-16T00:00:00.000Z'),
      ('t-beta', '2026-11-16T01:00:00.000Z', '2026-11-16T01:00:00.000Z');
  `);

  const slotStart = "2026-11-16T03:00:00.000Z";
  const { baseUrl, close } = await startTestServer(createApp);
  try {
    const response = await fetch(`${baseUrl}/v1/watch/reservations`, {
      method: "POST",
      headers: { ...authHeaders(bearerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ slot_start: slotStart, is_full_run: false }),
    });
    const body = await response.json();
    assert.deepEqual(body.selected_target_keys, ["t-alpha"]);
  } finally {
    await close();
    await pool.end();
  }
});

test("5分経過した未確認失敗を優先", { skip: !databaseConfigured }, async () => {
  const pool = createTestPool();
  await resetMonitoringFixture(pool);
  const slotStart = "2026-11-16T10:00:00.000Z";
  const failedAt = "2026-11-16T09:54:00.000Z";
  await pool.query(`
    INSERT INTO mikage.watch_target_states (
      target_key,
      last_checked_at,
      last_reserved_at,
      first_failed_at,
      failure_confirmed_at
    ) VALUES
      ('t-alpha', $1, '2026-11-16T09:50:00.000Z', $1, NULL),
      ('t-beta', '2026-11-16T09:00:00.000Z', '2026-11-16T09:00:00.000Z', NULL, NULL);
  `, [failedAt]);

  const { baseUrl, close } = await startTestServer(createApp);
  try {
    const response = await fetch(`${baseUrl}/v1/watch/reservations`, {
      method: "POST",
      headers: { ...authHeaders(bearerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ slot_start: slotStart, is_full_run: false }),
    });
    const body = await response.json();
    assert.deepEqual(body.selected_target_keys, ["t-alpha"]);
  } finally {
    await close();
    await pool.end();
  }
});

test("予約slotの結果はtransaction保存し、同一再送は冪等", { skip: !databaseConfigured }, async () => {
  const pool = createTestPool();
  await resetMonitoringFixture(pool);
  const slotStart = "2026-11-16T11:00:00.000Z";
  const checkedAt = "2026-11-16T11:00:02.000Z";
  const { baseUrl, close } = await startTestServer(createApp);
  try {
    const reservation = await fetch(baseUrl + "/v1/watch/reservations", {
      method: "POST",
      headers: { ...authHeaders(bearerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ slot_start: slotStart, is_full_run: true }),
    });
    assert.equal(reservation.status, 200);

    const body = {
      slot_start: slotStart,
      results: ["t-alpha", "t-beta"].map((target_key) => ({
        target_key, created_at: checkedAt, response_time: 120.5, status_code: target_key === "t-alpha" ? 503 : 200,
        status_message: "OK", error_name: null, error_code: null,
      })),
    };
    const send = (value) => fetch(baseUrl + "/v1/watch/results", {
      method: "POST",
      headers: { ...authHeaders(bearerToken), "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    const first = await send(body);
    assert.equal(first.status, 201);
    assert.equal((await first.json()).duplicate, false);

    const retryReservation = await fetch(baseUrl + "/v1/watch/reservations", {
      method: "POST",
      headers: { ...authHeaders(bearerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ slot_start: slotStart, is_full_run: true }),
    });
    assert.equal(retryReservation.status, 200);
    const retryReservationBody = await retryReservation.json();
    assert.deepEqual(retryReservationBody.selected_target_keys, ["t-alpha", "t-beta"]);
    assert.deepEqual(retryReservationBody.saved_results, body.results);

    const nextReservation = await fetch(baseUrl + "/v1/watch/reservations", {
      method: "POST",
      headers: { ...authHeaders(bearerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ slot_start: "2026-11-16T11:01:00.000Z", is_full_run: true }),
    });
    assert.equal(nextReservation.status, 200);

    const duplicate = await send({ ...body, results: [...body.results].reverse() });
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).duplicate, true);

    const conflict = await send({ ...body, results: body.results.map((row) => ({ ...row, status_code: 200 })) });
    assert.equal(conflict.status, 409);

    const saved = await pool.query("SELECT count(*)::int AS count FROM mikage.logs");
    assert.equal(saved.rows[0].count, 2);
    const logs = await pool.query("SELECT response_time FROM mikage.logs WHERE target_key='t-alpha'");
    assert.equal(logs.rows[0].response_time, 121);
    const states = await pool.query("SELECT target_key, to_char(first_failed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS first_failed_at, to_char(failure_confirmed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS failure_confirmed_at FROM mikage.watch_target_states ORDER BY target_key");
    assert.deepEqual(states.rows, [
      { target_key: "t-alpha", first_failed_at: checkedAt, failure_confirmed_at: null },
      { target_key: "t-beta", first_failed_at: null, failure_confirmed_at: null },
    ]);
  } finally {
    await close();
    await pool.end();
  }
});

test("予約されていないtargetの結果は保存しない", { skip: !databaseConfigured }, async () => {
  const pool = createTestPool();
  await resetMonitoringFixture(pool);
  const { baseUrl, close } = await startTestServer(createApp);
  try {
    const response = await fetch(baseUrl + "/v1/watch/results", {
      method: "POST",
      headers: { ...authHeaders(bearerToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        slot_start: "2026-11-16T12:00:00.000Z",
        results: [{ target_key: "t-alpha", created_at: "2026-11-16T12:00:02.000Z", status_code: 200 }],
      }),
    });
    assert.equal(response.status, 409);
    const saved = await pool.query("SELECT count(*)::int AS count FROM mikage.logs");
    assert.equal(saved.rows[0].count, 0);
  } finally {
    await close();
    await pool.end();
  }
});

test("5分以上継続した失敗はAPIがfailure_confirmed_atを記録", { skip: !databaseConfigured }, async () => {
  const pool = createTestPool();
  await resetMonitoringFixture(pool);
  const { baseUrl, close } = await startTestServer(createApp);
  try {
    for (const [slotStart, checkedAt] of [
      ["2026-11-16T14:00:00.000Z", "2026-11-16T14:00:02.000Z"],
      ["2026-11-16T14:05:00.000Z", "2026-11-16T14:05:02.000Z"],
    ]) {
      const reservation = await fetch(baseUrl + "/v1/watch/reservations", {
        method: "POST",
        headers: { ...authHeaders(bearerToken), "Content-Type": "application/json" },
        body: JSON.stringify({ slot_start: slotStart, is_full_run: true }),
      });
      assert.equal(reservation.status, 200);
      const response = await fetch(baseUrl + "/v1/watch/results", {
        method: "POST",
        headers: { ...authHeaders(bearerToken), "Content-Type": "application/json" },
        body: JSON.stringify({
          slot_start: slotStart,
          results: ["t-alpha", "t-beta"].map((target_key) => ({
            target_key, created_at: checkedAt, response_time: 20, status_code: target_key === "t-alpha" ? 503 : 200,
            status_message: target_key === "t-alpha" ? "Unavailable" : "OK",
          })),
        }),
      });
      assert.equal(response.status, 201);
    }
    const state = await pool.query("SELECT to_char(first_failed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS first_failed_at, to_char(failure_confirmed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS failure_confirmed_at FROM mikage.watch_target_states WHERE target_key='t-alpha'");
    assert.deepEqual(state.rows[0], {
      first_failed_at: "2026-11-16T14:00:02.000Z",
      failure_confirmed_at: "2026-11-16T14:05:02.000Z",
    });
  } finally {
    await close();
    await pool.end();
  }
});

test("NO_INTERNETはstatus異常でもwatch failure stateにしない", { skip: !databaseConfigured }, async () => {
  const pool = createTestPool();
  await resetMonitoringFixture(pool);
  const slotStart = "2026-11-16T15:00:00.000Z";
  const { baseUrl, close } = await startTestServer(createApp);
  try {
    const reservation = await fetch(baseUrl + "/v1/watch/reservations", {
      method: "POST",
      headers: { ...authHeaders(bearerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ slot_start: slotStart, is_full_run: true }),
    });
    assert.equal(reservation.status, 200);

    const response = await fetch(baseUrl + "/v1/watch/results", {
      method: "POST",
      headers: { ...authHeaders(bearerToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        slot_start: slotStart,
        results: ["t-alpha", "t-beta"].map((target_key) => ({
          target_key,
          created_at: "2026-11-16T15:00:02.000Z",
          response_time: null,
          status_code: 520,
          status_message: "No internet",
          error_name: "FetchError",
          error_code: "NO_INTERNET",
        })),
      }),
    });
    assert.equal(response.status, 201);
    const states = await pool.query("SELECT target_key, first_failed_at, failure_confirmed_at FROM mikage.watch_target_states ORDER BY target_key");
    assert.deepEqual(states.rows, [
      { target_key: "t-alpha", first_failed_at: null, failure_confirmed_at: null },
      { target_key: "t-beta", first_failed_at: null, failure_confirmed_at: null },
    ]);
  } finally {
    await close();
    await pool.end();
  }
});

test("full run の一部targetだけを結果保存する要求は拒否", { skip: !databaseConfigured }, async () => {
  const pool = createTestPool();
  await resetMonitoringFixture(pool);
  const slotStart = "2026-11-16T13:00:00.000Z";
  const { baseUrl, close } = await startTestServer(createApp);
  try {
    await fetch(baseUrl + "/v1/watch/reservations", {
      method: "POST",
      headers: { ...authHeaders(bearerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ slot_start: slotStart, is_full_run: true }),
    });
    const response = await fetch(baseUrl + "/v1/watch/results", {
      method: "POST",
      headers: { ...authHeaders(bearerToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        slot_start: slotStart,
        results: [{ target_key: "t-alpha", created_at: "2026-11-16T13:00:02.000Z", status_code: 200 }],
      }),
    });
    assert.equal(response.status, 409);
    const saved = await pool.query("SELECT count(*)::int AS count FROM mikage.logs");
    assert.equal(saved.rows[0].count, 0);
  } finally {
    await close();
    await pool.end();
  }
});

test("輪番予約の結果は予約された1targetだけを保存", { skip: !databaseConfigured }, async () => {
  const pool = createTestPool();
  await resetMonitoringFixture(pool);
  const slotStart = "2026-11-16T13:30:00.000Z";
  const checkedAt = "2026-11-16T13:30:02.000Z";
  const { baseUrl, close } = await startTestServer(createApp);
  try {
    const reservation = await fetch(baseUrl + "/v1/watch/reservations", {
      method: "POST",
      headers: { ...authHeaders(bearerToken), "Content-Type": "application/json" },
      body: JSON.stringify({ slot_start: slotStart, is_full_run: false }),
    });
    const selectedKeys = (await reservation.json()).selected_target_keys;
    assert.equal(reservation.status, 200);
    assert.equal(selectedKeys.length, 1);

    const response = await fetch(baseUrl + "/v1/watch/results", {
      method: "POST",
      headers: { ...authHeaders(bearerToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        slot_start: slotStart,
        results: [{ target_key: selectedKeys[0], created_at: checkedAt, status_code: 200 }],
      }),
    });
    assert.equal(response.status, 201);
    const saved = await pool.query("SELECT count(*)::int AS count FROM mikage.logs");
    assert.equal(saved.rows[0].count, 1);
  } finally {
    await close();
    await pool.end();
  }
});

test("View APIはtarget secretを返さず、ログをbucket集約する", { skip: !databaseConfigured }, async () => {
  const adminPool = createTestPool();
  await resetMonitoringFixture(adminPool);
  const checkedAt = new Date();
  checkedAt.setSeconds(10, 0);
  const { baseUrl, close } = await startTestServer(createApp);
  try {
    await adminPool.query(
      "INSERT INTO mikage.logs (target_key, created_at, response_time, status_code, status_message) VALUES ($1,$2,100,200,'OK'),($1,$3,201,503,'Unavailable')",
      ["t-alpha", checkedAt, new Date(checkedAt.getTime() + 20_000)]
    );

    const targetsResponse = await fetch(baseUrl + "/v1/view/targets", { headers: authHeaders(bearerToken) });
    assert.equal(targetsResponse.status, 200);
    const targets = await targetsResponse.json();
    assert.deepEqual(targets.targets, [
      { key: "t-alpha", name: "Alpha" },
      { key: "t-beta", name: "Beta" },
      { key: "t-off", name: "Off" },
    ]);

    const previewTargetUrl = `https://${PREVIEW_ALLOWED_HOSTS[0]}/a`;
    await adminPool.query("UPDATE mikage.targets SET url=$1 WHERE key='t-alpha'", [previewTargetUrl]);
    const proxyTargetResponse = await fetch(baseUrl + "/v1/view/target-proxy?key=t-alpha", { headers: authHeaders(bearerToken) });
    assert.equal(proxyTargetResponse.status, 200);
    assert.match(proxyTargetResponse.headers.get("cache-control") ?? "", /no-store/);
    assert.deepEqual((await proxyTargetResponse.json()).target, {
      name: "Alpha",
      url: previewTargetUrl,
      headers: null,
    });
    await adminPool.query("UPDATE mikage.targets SET headers='[\"invalid\"]'::jsonb WHERE key='t-alpha'");
    const invalidProxyTargetResponse = await fetch(baseUrl + "/v1/view/target-proxy?key=t-alpha", { headers: authHeaders(bearerToken) });
    assert.deepEqual((await invalidProxyTargetResponse.json()).target, null);
    await adminPool.query("UPDATE mikage.targets SET headers=NULL WHERE key='t-alpha'");
    await adminPool.query("UPDATE mikage.targets SET url=$1 WHERE key='t-alpha'", [`https://api.example.test/${"x".repeat(2048)}`]);
    const oversizedProxyTargetResponse = await fetch(baseUrl + "/v1/view/target-proxy?key=t-alpha", { headers: authHeaders(bearerToken) });
    assert.deepEqual((await oversizedProxyTargetResponse.json()).target, null);
    await adminPool.query("UPDATE mikage.targets SET url='https://api.example.test/a' WHERE key='t-alpha'");
    assert.equal((await fetch(baseUrl + "/v1/view/target-proxy?key=bad%20key", { headers: authHeaders(bearerToken) })).status, 400);
    const missingProxyTargetResponse = await fetch(baseUrl + "/v1/view/target-proxy?key=missing", { headers: authHeaders(bearerToken) });
    assert.equal(missingProxyTargetResponse.status, 200);
    assert.deepEqual((await missingProxyTargetResponse.json()).target, null);
    assert.equal((await fetch(baseUrl + "/v1/view/target-proxy?key=t-alpha")).status, 401);

    const logsResponse = await fetch(
      baseUrl + "/v1/view/logs?keys=t-alpha&start=" + encodeURIComponent(checkedAt.toISOString()) + "&end=" + encodeURIComponent(new Date(checkedAt.getTime() + 60_000).toISOString()),
      { headers: authHeaders(bearerToken) }
    );
    assert.equal(logsResponse.status, 200);
    const logs = await logsResponse.json();
    assert.equal(logs.data[0].key, "t-alpha");
    assert.equal(logs.data[0].logs.length, 1);
    assert.equal(logs.data[0].logs[0].response_time, 151);
    assert.equal(logs.data[0].logs[0].status_code, 503);
  } finally {
    await close();
    await adminPool.end();
  }
});

test("View errors/incidentsはJST月を読み、revisionはlogs更新で変わる", { skip: !databaseConfigured }, async () => {
  const adminPool = createTestPool();
  await resetMonitoringFixture(adminPool);
  const now = new Date();
  await adminPool.query(
    "INSERT INTO mikage.logs (target_key, created_at, response_time, status_code, error_code, error_name) VALUES ('t-alpha',$1,50,503,'E_TEST','Unavailable'),('t-alpha',$1,40,200,'NO_INTERNET','NetworkUnavailable')",
    [now]
  );
  await adminPool.query(
    "INSERT INTO mikage.incidents (keyword, created_at, updated_at, count, is_closed) VALUES ('saaske',$1,$1,2,false)",
    [now]
  );

  const { baseUrl, close } = await startTestServer(createApp);
  try {
    const revisionBefore = await (await fetch(baseUrl + "/v1/view/revision", { headers: authHeaders(bearerToken) })).json();
    const errors = await (await fetch(baseUrl + "/v1/view/errors?offset=0", { headers: authHeaders(bearerToken) })).json();
    assert.equal(errors.data.logs.length, 1);
    assert.equal(errors.data.logs[0].error_code, "E_TEST");
    const incidents = await (await fetch(baseUrl + "/v1/view/incidents?offset=0", { headers: authHeaders(bearerToken) })).json();
    assert.equal(incidents.data.length, 1);
    assert.equal(incidents.data[0].count, 2);
    assert.equal(typeof incidents.data[0].count, "number");

    await adminPool.query("INSERT INTO mikage.logs (target_key, created_at, status_code) VALUES ('t-alpha',$1,200)", [new Date()]);
    const revisionAfter = await (await fetch(baseUrl + "/v1/view/revision", { headers: authHeaders(bearerToken) })).json();
    assert.notEqual(revisionBefore.revision, revisionAfter.revision);
  } finally {
    await close();
    await adminPool.end();
  }
});

test("管理APIはhost allowlist、soft disable、値なしの監査履歴を適用", { skip: !databaseConfigured }, async () => {
  const pool = createTestPool();
  await resetMonitoringFixture(pool);
  const { baseUrl, close } = await startTestServer(createApp);
  try {
    const deniedHost = await fetchAdmin(baseUrl, "/v1/admin/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "new-target", name: "New", url: "https://not-allowed.invalid/", headers: null }),
    });
    assert.equal(deniedHost.status, 400);

    const created = await fetchAdmin(baseUrl, "/v1/admin/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "new-target", name: "New", url: "https://api.example.test/health",
        headers: { "X-Private": "do-not-audit-this-value" },
      }),
    });
    assert.equal(created.status, 201);

    const updated = await fetchAdmin(baseUrl, "/v1/admin/targets/new-target", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "New Name", url: "https://api.example.test/status",
        headers: { "X-Private": "rotated-value" },
      }),
    });
    assert.equal(updated.status, 200);

    const disabled = await fetchAdmin(baseUrl, "/v1/admin/targets/new-target/enabled", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_enabled: false }),
    });
    assert.equal(disabled.status, 200);

    const target = await pool.query("SELECT is_enabled FROM mikage.targets WHERE key='new-target'");
    assert.equal(target.rows[0].is_enabled, false);
    const audit = await pool.query("SELECT operation, changed_fields FROM mikage.target_change_audit WHERE target_key='new-target' ORDER BY id");
    assert.deepEqual(audit.rows.map((row) => row.operation), ["create", "update", "disable"]);
    assert.deepEqual(audit.rows[1].changed_fields.sort(), ["headers", "name", "url"]);
    const auditText = JSON.stringify(audit.rows);
    assert.equal(auditText.includes("do-not-audit-this-value"), false);
    assert.equal(auditText.includes("rotated-value"), false);
  } finally {
    await close();
    await pool.end();
  }
});

test("管理画面はAPIと同一originで配信し、private no-storeを付ける", { skip: !databaseConfigured }, async () => {
  const { baseUrl, close } = await startTestServer(createApp);
  try {
    const baseUrlObject = new URL(baseUrl);
    for (const path of ["/admin"]) {
      const publicHost = await new Promise((resolve, reject) => {
        const request = http.get({
          hostname: baseUrlObject.hostname,
          port: Number(baseUrlObject.port),
          path,
          headers: { Host: "public-gateway.example" },
        }, resolve);
        request.once("error", reject);
      });
      assert.equal(publicHost.statusCode, 404);
      publicHost.resume();
    }

    const requestAdminAsset = (path) => new Promise((resolve, reject) => {
      const request = http.get({
        hostname: baseUrlObject.hostname,
        port: Number(baseUrlObject.port),
        path,
        headers: { Host: "admin.example.test" },
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        }));
      });
      request.once("error", reject);
    });

    const pageResponse = await requestAdminAsset("/admin");
    assert.equal(pageResponse.status, 200);
    assert.match(pageResponse.headers["content-security-policy"] ?? "", /default-src 'self'/);
    assert.match(pageResponse.headers["cache-control"] ?? "", /no-store/);
    assert.match(pageResponse.body, /監視対象管理/);

    const scriptResponse = await requestAdminAsset("/admin.js");
    assert.equal(scriptResponse.status, 200);
    assert.match(scriptResponse.headers["content-type"] ?? "", /javascript/);
    assert.match(scriptResponse.body, /v1\/admin\/targets/);
  } finally {
    await close();
  }
});

test("管理APIはnull headersを受け入れ、壊れたJSONや外部Originの更新を拒否", { skip: !databaseConfigured }, async () => {
  const pool = createTestPool();
  await resetMonitoringFixture(pool);
  const { baseUrl, close } = await startTestServer(createApp);
  try {
    const invalidHeaders = await fetchAdmin(baseUrl, "/v1/admin/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "bad-header", name: "Bad", url: "https://example.invalid", headers: ["not", "object"] }),
    });
    assert.equal(invalidHeaders.status, 400);

    const malformed = await fetchAdmin(baseUrl, "/v1/admin/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{invalid",
    });
    assert.equal(malformed.status, 400);

    const crossOrigin = await fetchAdmin(baseUrl, "/v1/admin/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://outside.invalid" },
      body: JSON.stringify({ key: "origin-test", name: "Origin", url: "https://api.example.test", headers: null }),
    });
    assert.equal(crossOrigin.status, 403);

    const nullHeaders = await fetchAdmin(baseUrl, "/v1/admin/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "null-headers", name: "Null headers", url: "https://api.example.test", headers: null }),
    });
    assert.equal(nullHeaders.status, 201);
    const list = await fetchAdmin(baseUrl, "/v1/admin/targets");
    assert.equal(list.status, 200);
    assert.match(list.headers.get("cache-control") ?? "", /no-store/);
  } finally {
    await close();
    await pool.end();
  }
});

test("incident APIはopen/update/closeをidempotentに保存し、競合内容を拒否", { skip: !databaseConfigured }, async () => {
  const pool = createTestPool();
  await resetMonitoringFixture(pool);
  const { baseUrl, close } = await startTestServer(createApp);
  try {
    const send = (body) => fetch(baseUrl + "/v1/watch/incidents", {
      method: "POST",
      headers: { ...authHeaders(bearerToken), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const openBody = {
      request_id: "slot-incident:saaske:open",
      operation: "open",
      keyword: "saaske",
      incident_id: null,
      now: "2026-11-16T16:00:00.000Z",
      count: 1,
    };
    const opened = await send(openBody);
    assert.equal(opened.status, 201);
    const openResult = await opened.json();
    assert.ok(openResult.incident_id > 0);
    const openedIncident = await pool.query("SELECT notification_pending FROM mikage.incidents WHERE id=$1", [openResult.incident_id]);
    assert.equal(openedIncident.rows[0].notification_pending, true);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM mikage.incident_transition_batches")).rows[0].count, 1);
    const duplicateOpen = await send(openBody);
    assert.equal(duplicateOpen.status, 200);
    const duplicateOpenBody = await duplicateOpen.json();
    assert.equal(duplicateOpenBody.duplicate, true);
    assert.equal(duplicateOpenBody.incident_id, openResult.incident_id);
    const conflict = await send({ ...openBody, now: "2026-11-16T16:00:01.000Z" });
    assert.equal(conflict.status, 409);

    const pendingBody = {
      request_id: "slot-incident:saaske:pending",
      operation: "notification_pending",
      keyword: "saaske",
      incident_id: openResult.incident_id,
      now: "2026-11-16T16:04:59.000Z",
    };
    const pending = await send(pendingBody);
    assert.equal(pending.status, 201);
    const pendingIncident = await pool.query("SELECT notification_pending FROM mikage.incidents WHERE id=$1", [openResult.incident_id]);
    assert.equal(pendingIncident.rows[0].notification_pending, true);
    const duplicatePending = await send(pendingBody);
    assert.equal(duplicatePending.status, 200);
    assert.equal((await duplicatePending.json()).duplicate, true);

    const updated = await send({
      request_id: "slot-incident:saaske:update",
      operation: "update",
      keyword: "saaske",
      incident_id: openResult.incident_id,
      now: "2026-11-16T16:05:00.000Z",
      count: 2,
      instatus_id: "test-instatus-id",
      googlechat_name: "spaces/test/thread",
    });
    assert.equal(updated.status, 201, await updated.text());
    const updatedIncident = await pool.query("SELECT notification_pending FROM mikage.incidents WHERE id=$1", [openResult.incident_id]);
    assert.equal(updatedIncident.rows[0].notification_pending, false);

    const closed = await send({
      request_id: "slot-incident:saaske:close",
      operation: "close",
      keyword: "saaske",
      incident_id: openResult.incident_id,
      now: "2026-11-16T16:06:00.000Z",
    });
    assert.equal(closed.status, 201);
    const incident = await pool.query("SELECT count, is_closed, instatus_id, googlechat_name, notification_pending FROM mikage.incidents WHERE id=$1", [openResult.incident_id]);
    assert.deepEqual(incident.rows[0], { count: "2", is_closed: true, instatus_id: "test-instatus-id", googlechat_name: "spaces/test/thread", notification_pending: false });
    const stateResponse = await fetch(baseUrl + "/v1/watch/state", { headers: authHeaders(bearerToken) });
    assert.equal(stateResponse.status, 200);
    const stateBody = await stateResponse.json();
    assert.equal(stateBody.states.length, 0);
    assert.equal(stateBody.active_incidents.length, 0);
    assert.equal((await send({ ...pendingBody, request_id: "closed-incident:pending" })).status, 404);
  } finally {
    await close();
    await pool.end();
  }
});
