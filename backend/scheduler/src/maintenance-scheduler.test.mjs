import assert from "node:assert/strict";
import test from "node:test";
import { getMaintenanceJob, runMaintenanceJob } from "./maintenance-scheduler.mjs";

test("JST月初はデータを削除せず、reindexだけを予定する", () => {
  assert.equal(getMaintenanceJob(new Date("2026-11-30T18:00:00.000Z")), null);
  assert.equal(getMaintenanceJob(new Date("2026-11-30T18:05:00.000Z")), "reindex_logs");
  assert.equal(getMaintenanceJob(new Date("2026-11-30T18:07:00.000Z")), "reindex_incidents");
  assert.equal(getMaintenanceJob(new Date("2026-11-30T18:01:00.000Z")), null);
  assert.equal(getMaintenanceJob(new Date("2026-11-30T19:00:00.000Z")), null);
  assert.equal(getMaintenanceJob(new Date("2026-11-29T18:00:00.000Z")), null);
});

test("maintenance jobは移行照合ゲートが閉じている場合に停止する", async () => {
  let jobStarted = false;
  await assert.rejects(
    runMaintenanceJob("reindex_logs", {
      async query() { return { rows: [{ data_verified: false }] }; },
      async connect() { jobStarted = true; throw new Error("unexpected connection"); },
    }),
    /移行データの照合が完了していません/
  );
  assert.equal(jobStarted, false);
});

test("削除jobは実行せず、未知のmaintenance jobとして拒否する", async () => {
  const statements = [];
  let jobStarted = false;
  await assert.rejects(
    runMaintenanceJob("prune", {
      async query(statement) {
        statements.push(statement);
        return { rows: [{ data_verified: true }] };
      },
      async connect() { jobStarted = true; throw new Error("unexpected connection"); },
    }),
    /未対応のmaintenance job/
  );
  assert.deepEqual(statements, ["SELECT data_verified FROM mikage.migration_state WHERE singleton = true"]);
  assert.equal(jobStarted, false);
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
