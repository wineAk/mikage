import assert from "node:assert/strict";
import test from "node:test";
import { assertTestDatabaseIsolated } from "./test-database-isolation.mjs";

test("maintenance and snapshot fixtures reject production or mismatched DB configuration", () => {
  for (const expectedHost of ["postgres-test-maintenance"]) {
    const isolatedDatabase = {
      MIKAGE_TEST_DATABASE_ISOLATED: "true",
      PGHOST: expectedHost,
      PGPORT: "5432",
      PGDATABASE: "mikage_test",
      TEST_PGHOST: expectedHost,
      TEST_PGPORT: "5432",
      TEST_PGDATABASE: "mikage_test",
    };

    assert.doesNotThrow(() => assertTestDatabaseIsolated(expectedHost, isolatedDatabase));
    assert.throws(
      () => assertTestDatabaseIsolated(expectedHost, { ...isolatedDatabase, MIKAGE_TEST_DATABASE_ISOLATED: "false" }),
      /MIKAGE_TEST_DATABASE_ISOLATED=true/
    );
    assert.throws(
      () => assertTestDatabaseIsolated(expectedHost, { ...isolatedDatabase, PGDATABASE: "mikage", TEST_PGDATABASE: "mikage" }),
      /_test サフィックス/
    );
    assert.throws(
      () => assertTestDatabaseIsolated(expectedHost, { ...isolatedDatabase, TEST_PGHOST: "postgres" }),
      /同一の test PostgreSQL/
    );
    assert.throws(
      () => assertTestDatabaseIsolated(expectedHost, { ...isolatedDatabase, PGHOST: "postgres", TEST_PGHOST: "postgres" }),
      /同一の test PostgreSQL/
    );
  }
});
