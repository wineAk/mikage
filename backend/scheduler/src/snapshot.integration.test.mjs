import assert from "node:assert/strict";
import pg from "pg";
import test, { after } from "node:test";

const databaseConfigured = Boolean(process.env.TEST_PGHOST);
const pool = databaseConfigured
  ? new pg.Pool({
      host: process.env.TEST_PGHOST,
      port: Number(process.env.TEST_PGPORT ?? "5432"),
      user: process.env.TEST_PGUSER,
      password: process.env.TEST_PGPASSWORD,
      database: process.env.TEST_PGDATABASE,
      max: 3,
    })
  : null;

after(async () => {
  await pool?.end();
});

test("exported read-only snapshot keeps row reads stable across a concurrent committed write", { skip: !databaseConfigured }, async () => {
  const tableName = `snapshot_probe_${crypto.randomUUID().replaceAll("-", "")}`;
  const setup = await pool.connect();
  const exporter = await pool.connect();
  const importer = await pool.connect();
  let tableCreated = false;

  try {
    await setup.query(`CREATE TABLE public.${tableName} (value integer PRIMARY KEY)`);
    tableCreated = true;
    await setup.query(`INSERT INTO public.${tableName} VALUES (1)`);

    await exporter.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshotId = (await exporter.query("SELECT pg_export_snapshot() AS id")).rows[0].id;
    assert.match(snapshotId, /^[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+$/);

    await setup.query(`INSERT INTO public.${tableName} VALUES (2)`);
    await importer.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await importer.query(`SET TRANSACTION SNAPSHOT '${snapshotId}'`);

    const sharedSnapshotCount = await importer.query(`SELECT count(*)::text AS count FROM public.${tableName}`);
    const currentCount = await setup.query(`SELECT count(*)::text AS count FROM public.${tableName}`);
    assert.equal(sharedSnapshotCount.rows[0].count, "1");
    assert.equal(currentCount.rows[0].count, "2");

    await importer.query("COMMIT");
    await exporter.query("ROLLBACK");
  } finally {
    await Promise.allSettled([
      importer.query("ROLLBACK"),
      exporter.query("ROLLBACK"),
    ]);
    importer.release();
    exporter.release();
    setup.release();
    if (tableCreated) await pool.query(`DROP TABLE IF EXISTS public.${tableName}`);
  }
});
