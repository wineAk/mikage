import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertTestDatabaseIsolated } from "./helpers.mjs";

const isolatedApiDatabase = {
  MIKAGE_TEST_DATABASE_ISOLATED: "true",
  PGHOST: "postgres-test-api",
  PGPORT: "5432",
  PGDATABASE: "mikage_test",
  TEST_PGHOST: "postgres-test-api",
  TEST_PGPORT: "5432",
  TEST_PGDATABASE: "mikage_test",
};

test("API fixture DB guard rejects unsafe or mismatched DB configuration", () => {
  assert.throws(
    () => assertTestDatabaseIsolated({ ...isolatedApiDatabase, MIKAGE_TEST_DATABASE_ISOLATED: "false" }),
    /MIKAGE_TEST_DATABASE_ISOLATED=true/
  );
  assert.throws(
    () => assertTestDatabaseIsolated({ ...isolatedApiDatabase, TEST_PGHOST: "postgres" }),
    /同一の test PostgreSQL/
  );
  assert.throws(
    () => assertTestDatabaseIsolated({ ...isolatedApiDatabase, PGDATABASE: "mikage", TEST_PGDATABASE: "mikage" }),
    /_test サフィックス/
  );
  assert.throws(
    () => assertTestDatabaseIsolated({ ...isolatedApiDatabase, PGHOST: "postgres", TEST_PGHOST: "postgres" }),
    /同一の test PostgreSQL/
  );
  assert.doesNotThrow(() => assertTestDatabaseIsolated(isolatedApiDatabase));
});

test("monitoring API rejects an unverified test destination before loading the application pool", () => {
  const childEnvironment = {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    MIKAGE_TEST_DATABASE_ISOLATED: "true",
    TEST_PGHOST: "postgres-test-api",
    TEST_PGPORT: "5432",
    TEST_PGDATABASE: "mikage_test",
    PGDATABASE: "mikage_test",
  };
  const monitoringTestUrl = new URL("./monitoring-api.test.mjs", import.meta.url).href;
  const expectedTestPath = fileURLToPath(new URL("./monitoring-api.test.mjs", import.meta.url)).replaceAll("\\", "/");
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `await import(${JSON.stringify(monitoringTestUrl)})`],
    { encoding: "utf8", env: childEnvironment }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PG\* と TEST_PG\* は同一の test PostgreSQL/);
  assert.match(result.stderr, new RegExp(expectedTestPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(result.stderr, /PGHOST が未設定です/);
});
