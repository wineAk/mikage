import assert from "node:assert/strict";
import pg from "pg";
import test, { after } from "node:test";
import { runMaintenanceJob } from "./maintenance-scheduler.mjs";
import { assertTestDatabaseIsolated as assertIsolated } from "./test-database-isolation.mjs";

const assertTestDatabaseIsolated = (environment = process.env) =>
  assertIsolated("postgres-test-maintenance", environment);

const databaseConfigured = Boolean(process.env.TEST_PGHOST);
if (databaseConfigured) {
  assertTestDatabaseIsolated();
}
const pool = databaseConfigured
  ? new pg.Pool({
      host: process.env.TEST_PGHOST,
      port: Number(process.env.TEST_PGPORT ?? "5432"),
      user: "mikage_maintenance",
      password: process.env.TEST_MAINTENANCE_PGPASSWORD,
      database: process.env.TEST_PGDATABASE,
    })
  : null;
const fixturePool = databaseConfigured
  ? new pg.Pool({
      host: process.env.TEST_PGHOST,
      port: Number(process.env.TEST_PGPORT ?? "5432"),
      user: process.env.TEST_PGUSER,
      password: process.env.TEST_PGPASSWORD,
      database: process.env.TEST_PGDATABASE,
    })
  : null;

after(async () => {
  await Promise.all([pool?.end(), fixturePool?.end()]);
});

test("maintenance DB role preserves historical rows and can reindex only owned tables", { skip: !databaseConfigured }, async () => {
  assertTestDatabaseIsolated();
  const ownership = await pool.query("SELECT current_user, pg_has_role(current_user, 'mikage_data_owner', 'member') AS owns_maintenance_tables");
  assert.equal(ownership.rows[0].current_user, "mikage_maintenance");
  assert.equal(ownership.rows[0].owns_maintenance_tables, true);

  await pool.query("REINDEX TABLE CONCURRENTLY mikage.logs");
  await pool.query("REINDEX TABLE CONCURRENTLY mikage.incidents");
  await assert.rejects(pool.query("REINDEX TABLE CONCURRENTLY mikage.targets"), (error) => error.code === "42501");

  const oldRecord = new Date("2020-01-01T00:00:00.000Z");
  const currentRecord = new Date();
  const marker = `maintenance-${crypto.randomUUID()}`;
  let createdLogCount = 0;
  let incidentCount = 0;
  const currentSlot = new Date(currentRecord.getTime() + 60_000);
  const oldSlot = new Date(oldRecord.getTime() + 60_000);
  const oldBatchRequestId = `${marker}:old`;
  const currentBatchRequestId = `${marker}:current`;
  try {
    await fixturePool.query(
      "INSERT INTO mikage.targets (key, name, url) VALUES ($1,$1,'https://example.invalid')",
      [marker]
    );
    const createdLogs = await pool.query(
      "INSERT INTO mikage.logs (target_key, created_at, status_code, error_code) VALUES ($1,$2,200,$3),($1,$4,200,$5) RETURNING id, created_at",
      [marker, oldRecord, `${marker}-old`, currentRecord, `${marker}-current`]
    );
    createdLogCount = createdLogs.rowCount;
    const incident = await pool.query(
      "INSERT INTO mikage.incidents (keyword, created_at, updated_at) VALUES ($1,$2,$2),($3,$4,$4) RETURNING keyword, created_at",
      [`${marker}-old`, oldRecord, `${marker}-current`, currentRecord]
    );
    incidentCount = incident.rowCount;
    await pool.query(
      "INSERT INTO mikage.watch_result_batches (slot_start, request_hash, saved_at) VALUES ($1, repeat('a', 64), $2), ($3, repeat('b', 64), $4)",
      [oldSlot, oldRecord, currentSlot, currentRecord]
    );
    await pool.query(
      "INSERT INTO mikage.incident_transition_batches (request_id, request_hash, transition, saved_at) VALUES ($1, repeat('c', 64), 'open', $2), ($3, repeat('d', 64), 'update', $4)",
      [oldBatchRequestId, oldRecord, currentBatchRequestId, currentRecord]
    );
    await fixturePool.query("UPDATE mikage.migration_state SET data_verified=true, verified_at=clock_timestamp() WHERE singleton=true");
    await assert.rejects(runMaintenanceJob("prune", pool), /未対応のmaintenance job/);
    const retainedLogs = await pool.query("SELECT count(*)::int AS count FROM mikage.logs WHERE error_code LIKE $1", [`${marker}-%`]);
    const retainedIncidents = await pool.query("SELECT count(*)::int AS count FROM mikage.incidents WHERE keyword LIKE $1", [`${marker}-%`]);
    const retainedWatchBatches = await pool.query("SELECT count(*)::int AS count FROM mikage.watch_result_batches WHERE slot_start IN ($1, $2)", [oldSlot, currentSlot]);
    const retainedIncidentBatches = await pool.query("SELECT count(*)::int AS count FROM mikage.incident_transition_batches WHERE request_id IN ($1, $2)", [oldBatchRequestId, currentBatchRequestId]);
    assert.equal(retainedLogs.rows[0].count, 2);
    assert.equal(retainedIncidents.rows[0].count, 2);
    assert.equal(retainedWatchBatches.rows[0].count, 2);
    assert.equal(retainedIncidentBatches.rows[0].count, 2);
  } finally {
    await pool.query("DELETE FROM mikage.logs WHERE error_code LIKE $1", [`${marker}-%`]);
    await pool.query("DELETE FROM mikage.incidents WHERE keyword LIKE $1", [`${marker}-%`]);
    await pool.query("DELETE FROM mikage.watch_result_batches WHERE slot_start IN ($1, $2)", [oldSlot, currentSlot]);
    await pool.query("DELETE FROM mikage.incident_transition_batches WHERE request_id IN ($1, $2)", [oldBatchRequestId, currentBatchRequestId]);
    await fixturePool.query("DELETE FROM mikage.targets WHERE key=$1", [marker]);
    await fixturePool.query("UPDATE mikage.migration_state SET data_verified=false, verified_at=NULL WHERE singleton=true");
  }
  assert.equal(createdLogCount, 2);
  assert.equal(incidentCount, 2);
});
