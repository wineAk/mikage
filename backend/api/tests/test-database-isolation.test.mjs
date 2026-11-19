import assert from "node:assert/strict";
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
