import assert from "node:assert/strict";
import test from "node:test";
import { getMaintenanceJob, runMaintenanceJob } from "./maintenance-scheduler.mjs";

test("JST月初の削除・reindexだけを予定する", () => {
  assert.equal(getMaintenanceJob(new Date("2026-11-30T18:00:00.000Z")), "prune");
  assert.equal(getMaintenanceJob(new Date("2026-11-30T18:05:00.000Z")), "reindex_logs");
  assert.equal(getMaintenanceJob(new Date("2026-11-30T18:07:00.000Z")), "reindex_incidents");
  assert.equal(getMaintenanceJob(new Date("2026-11-30T18:01:00.000Z")), null);
  assert.equal(getMaintenanceJob(new Date("2026-11-30T19:00:00.000Z")), null);
  assert.equal(getMaintenanceJob(new Date("2026-11-29T18:00:00.000Z")), null);
});

test("maintenance jobは移行照合ゲートが閉じている場合に停止する", async () => {
  let jobStarted = false;
  await assert.rejects(
    runMaintenanceJob("prune", {
      async query() { return { rows: [{ data_verified: false }] }; },
      async connect() { jobStarted = true; throw new Error("unexpected connection"); },
    }),
    /移行データの照合が完了していません/
  );
  assert.equal(jobStarted, false);
});

test("pruneは監視データと冪等性記録を一つのtransactionでJST前月初より古い分だけ削除する", async () => {
  const statements = [];
  const client = {
    async query(statement) {
      statements.push(statement);
      return { rowCount: 3 };
    },
    release() { statements.push("RELEASE"); },
  };
  const result = await runMaintenanceJob("prune", {
    async query() { return { rows: [{ data_verified: true }] }; },
    async connect() { return client; },
  });
  assert.deepEqual(result, {
    logsDeleted: 3,
    incidentsDeleted: 3,
    watchBatchesDeleted: 3,
    incidentBatchesDeleted: 3,
  });
  assert.deepEqual(statements.map((statement) => statement.split(" ")[0]), ["BEGIN", "DELETE", "DELETE", "DELETE", "DELETE", "COMMIT", "RELEASE"]);
  for (const statement of statements.slice(1, 5)) {
    assert.equal(statement.includes("Asia/Tokyo"), true);
    assert.equal(statement.includes("INTERVAL '1 month'"), true);
  }
  assert.match(statements[3], /watch_result_batches/);
  assert.match(statements[4], /incident_transition_batches/);
});

test("reindexはtransactionを使わない並行実行SQLを発行する", async () => {
  const statements = [];
  const pool = { async query(statement) {
    if (statement === "SELECT data_verified FROM mikage.migration_state WHERE singleton = true") {
      return { rows: [{ data_verified: true }] };
    }
    statements.push(statement);
  } };
  await runMaintenanceJob("reindex_logs", pool);
  await runMaintenanceJob("reindex_incidents", pool);
  assert.deepEqual(statements, [
    "REINDEX TABLE CONCURRENTLY mikage.logs",
    "REINDEX TABLE CONCURRENTLY mikage.incidents",
  ]);
});
