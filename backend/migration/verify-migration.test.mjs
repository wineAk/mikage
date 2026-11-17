import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPageQuery,
  buildSetSnapshotStatement,
  assertSourceWritesFrozen,
  assertSourceConsistencyMode,
  assertSourceRoleCanReadAllRows,
  areSequenceStatesCompatible,
  comparePageRows,
  createSourcePool,
  getTargetsSourceProjection,
  compareSchemaContracts,
  isTargetHostAllowlistComplete,
  isSequenceStateSafe,
  isSequenceUnused,
  isValidExportedSnapshotId,
} from "./verify-migration.mjs";

function withSourceEnv(values, callback) {
  const names = [
    "MIKAGE_SOURCE_PGHOST",
    "MIKAGE_SOURCE_PGUSER",
    "MIKAGE_SOURCE_PGPASSWORD",
    "MIKAGE_SOURCE_WRITES_FROZEN",
    "MIKAGE_SOURCE_SNAPSHOT_ID",
    "MIKAGE_SOURCE_PGSSLMODE",
    "MIKAGE_SOURCE_PGSSLROOTCERT_BASE64",
  ];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) {
    if (Object.hasOwn(values, name)) process.env[name] = values[name];
    else delete process.env[name];
  }
  try {
    callback();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function createSchemaContract(overrides = []) {
  const tables = ["targets", "logs", "incidents", "watch_scheduler_lock", "watch_target_states", "watch_result_batches", "page_cache_revision", "target_change_audit", "incident_transition_batches"];
  const sequences = ["logs_id_seq", "incidents_id_seq", "target_change_audit_id_seq"];
  const indexes = ["targets_pkey", "logs_pkey", "incidents_pkey", "watch_scheduler_lock_pkey", "watch_target_states_pkey", "watch_result_batches_pkey", "page_cache_revision_pkey", "target_change_audit_pkey", "incident_transition_batches_pkey", "idx_logs_created_at", "idx_logs_target_key", "idx_logs_target_key_created_at", "idx_logs_error_created_at"];
  const rows = [
    ...tables.map((name) => ({ kind: "table", name, definition: "true" })),
    ...sequences.map((name) => ({ kind: "sequence", name, definition: "true" })),
    { kind: "function", name: "bump_page_cache_revision", definition: "function" },
    ...tables.map((name) => ({ kind: "columns", name, definition: name === "targets" ? "[]" : tables.slice(0, 4).includes(name) ? "[]" : "present" })),
    ...tables.map((name) => ({ kind: "constraints", name, definition: "[]" })),
    ...indexes.map((name) => ({ kind: "index", name, definition: "index" })),
    ...["page_cache_revision_logs", "page_cache_revision_targets", "page_cache_revision_incidents"].map((name) => ({ kind: "trigger", name, definition: "trigger" })),
    ...overrides,
  ];
  return [...new Map(rows.map((row) => [`${row.kind}:${row.name}`, row])).values()];
}

test("migration page comparison accepts identical keys and row hashes", () => {
  const rows = [
    { cursor: "alpha", row_hash: "hash-1" },
    { cursor: "beta", row_hash: "hash-2" },
  ];

  assert.equal(comparePageRows(rows, structuredClone(rows)), true);
});

test("schema contract comparison accepts legacy targets while checking transferred columns and constraints", () => {
  const columns = JSON.stringify([["key","text","NO",null,"",""],["name","text","NO",null,"",""],["url","text","NO",null,"",""],["headers","jsonb","YES",null,"",""]]);
  const source = createSchemaContract([{ kind: "columns", name: "targets", definition: columns }]);
  assert.equal(compareSchemaContracts(source, structuredClone(source)), true);
  const modern = structuredClone(source);
  modern.find((row) => row.kind === "columns" && row.name === "targets").definition = JSON.stringify([...JSON.parse(columns), ["is_enabled","boolean","NO","true","YES","ALWAYS"]]);
  assert.equal(compareSchemaContracts(source, modern), true);
  const changedDataColumn = structuredClone(source);
  changedDataColumn.find((row) => row.kind === "columns" && row.name === "targets").definition = JSON.stringify([...JSON.parse(columns), ["new_column","text","YES",null,"",""]]);
  assert.equal(compareSchemaContracts(source, changedDataColumn), false);
  const missingRequired = structuredClone(source);
  missingRequired.find((row) => row.kind === "index" && row.name === "targets_pkey").definition = "missing";
  assert.equal(compareSchemaContracts(source, missingRequired), false);
  assert.equal(compareSchemaContracts(source, source.slice(0, -1)), false);
});

test("schema contract accepts destination-only notification recovery state on incidents", () => {
  const columns = JSON.stringify([
    ["id", "bigint", "NO", null, "", ""],
    ["keyword", "text", "NO", "'unknown'::text", "YES", "ALWAYS"],
  ]);
  const source = createSchemaContract([{ kind: "columns", name: "incidents", definition: columns }]);
  const target = structuredClone(source);
  target.find((row) => row.kind === "columns" && row.name === "incidents").definition = JSON.stringify([
    ...JSON.parse(columns),
    ["notification_pending", "boolean", "NO", "false", "YES", "ALWAYS"],
  ]);
  assert.equal(compareSchemaContracts(source, target), true);
});

test("schema contract permits destination-only migration objects missing from Supabase", () => {
  const source = createSchemaContract([
    { kind: "table", name: "target_change_audit", definition: "false" },
    { kind: "sequence", name: "target_change_audit_id_seq", definition: "false" },
    { kind: "function", name: "bump_page_cache_revision", definition: "missing" },
    { kind: "index", name: "idx_logs_created_at", definition: "source-index" },
    { kind: "trigger", name: "page_cache_revision_logs", definition: "missing" },
  ]);
  const target = createSchemaContract([{ kind: "index", name: "idx_logs_created_at", definition: "source-index" }]);
  assert.equal(compareSchemaContracts(source, target), true);

  const missingDestinationObject = structuredClone(target);
  missingDestinationObject.find((row) => row.kind === "table" && row.name === "target_change_audit").definition = "false";
  assert.equal(compareSchemaContracts(source, missingDestinationObject), false);
  const missingSourceDataTable = structuredClone(source);
  missingSourceDataTable.find((row) => row.kind === "table" && row.name === "logs").definition = "false";
  assert.equal(compareSchemaContracts(missingSourceDataTable, target), false);
});

test("migration tools require an explicit operator acknowledgement that all source writers are stopped", () => {
  assert.throws(() => assertSourceWritesFrozen(undefined), { code: "MIGRATION_SOURCE_NOT_FROZEN" });
  assert.throws(() => assertSourceWritesFrozen("false"), { code: "MIGRATION_SOURCE_NOT_FROZEN" });
  assert.doesNotThrow(() => assertSourceWritesFrozen("true"));
});

test("migration consistency accepts either a writer freeze or a live exported snapshot", () => {
  assert.throws(() => assertSourceConsistencyMode(undefined, undefined), { code: "MIGRATION_SOURCE_NOT_FROZEN" });
  assert.doesNotThrow(() => assertSourceConsistencyMode("true", undefined));
  assert.doesNotThrow(() => assertSourceConsistencyMode(undefined, "00000003-0000001B-1"));
  assert.throws(() => assertSourceConsistencyMode("true", "invalid snapshot"), { code: "MIGRATION_SOURCE_SNAPSHOT_INVALID" });
  assert.equal(isValidExportedSnapshotId("00000003-0000001B-1"), true);
  assert.equal(isValidExportedSnapshotId("00000003-0000001B-1'; DROP TABLE mikage.logs;--"), false);
  assert.equal(isValidExportedSnapshotId(""), false);
  assert.equal(buildSetSnapshotStatement("00000003-0000001B-1"), "SET TRANSACTION SNAPSHOT '00000003-0000001B-1'");
  assert.throws(() => buildSetSnapshotStatement("invalid snapshot"), { code: "MIGRATION_SOURCE_SNAPSHOT_INVALID" });
});

test("migration verifier requires a source role that bypasses RLS", () => {
  assert.throws(() => assertSourceRoleCanReadAllRows(undefined), { code: "MIGRATION_SOURCE_RLS_BYPASS" });
  assert.throws(() => assertSourceRoleCanReadAllRows({ rolsuper: false, rolbypassrls: false }), { code: "MIGRATION_SOURCE_RLS_BYPASS" });
  assert.doesNotThrow(() => assertSourceRoleCanReadAllRows({ rolsuper: false, rolbypassrls: true }));
  assert.doesNotThrow(() => assertSourceRoleCanReadAllRows({ rolsuper: true, rolbypassrls: false }));
});

test("migration page comparison rejects missing, reordered, or changed rows", () => {
  const sourceRows = [
    { cursor: "1", row_hash: "hash-1" },
    { cursor: "2", row_hash: "hash-2" },
  ];

  assert.equal(comparePageRows(sourceRows, sourceRows.slice(0, 1)), false);
  assert.equal(comparePageRows(sourceRows, [...sourceRows].reverse()), false);
  assert.equal(comparePageRows(sourceRows, [sourceRows[0], { cursor: "2", row_hash: "changed" }]), false);
});

test("text-key migration pages use a stable C collation on both sides of the cursor", () => {
  const query = buildPageQuery({
    name: "targets",
    key: "key",
    keyType: "text",
    rowJson: "to_jsonb(t)::text",
  });

  assert.match(query, /t\.key COLLATE "C" > \$1::text COLLATE "C"/);
  assert.match(query, /ORDER BY t\.key COLLATE "C"/);
});

test("numeric-key migration pages keep native numeric ordering", () => {
  const query = buildPageQuery({
    name: "logs",
    key: "id",
    keyType: "integer",
    rowJson: "to_jsonb(t)::text",
  });

  assert.match(query, /t\.id > \$1::integer/);
  assert.match(query, /ORDER BY t\.id/);
  assert.doesNotMatch(query, /COLLATE/);
});

test("migration source connection requires credentials and a verified CA", () => {
  class MockPool {
    constructor(options) {
      this.options = options;
    }
  }

  withSourceEnv({}, () => {
    assert.throws(() => createSourcePool(MockPool), { code: "MIGRATION_SOURCE_CONFIG" });
  });

  const ca = Buffer.from("-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----").toString("base64");
  withSourceEnv({
    MIKAGE_SOURCE_PGHOST: "supabase.example.test",
    MIKAGE_SOURCE_PGUSER: "postgres.project",
    MIKAGE_SOURCE_PGPASSWORD: "test-only",
    MIKAGE_SOURCE_PGSSLROOTCERT_BASE64: ca,
  }, () => {
    const pool = createSourcePool(MockPool);
    assert.equal(pool.options.ssl.rejectUnauthorized, true);
    assert.match(pool.options.ssl.ca, /BEGIN CERTIFICATE/);
    assert.equal(pool.options.application_name, "mikage-migration-verifier");
  });

  withSourceEnv({
    MIKAGE_SOURCE_PGHOST: "supabase.example.test",
    MIKAGE_SOURCE_PGUSER: "postgres.project",
    MIKAGE_SOURCE_PGPASSWORD: "test-only",
    MIKAGE_SOURCE_PGSSLMODE: "verify-ca",
    MIKAGE_SOURCE_PGSSLROOTCERT_BASE64: ca,
  }, () => {
    assert.throws(() => createSourcePool(MockPool), { code: "MIGRATION_SOURCE_TLS_CONFIG" });
  });
});

test("migration verifier rejects identity sequence states that can reuse an existing ID", () => {
  assert.equal(isSequenceStateSafe({ last_value: "8", max_id: "8", is_called: false }), false);
  assert.equal(isSequenceStateSafe({ last_value: "8", max_id: "8", is_called: true }), true);
  assert.equal(isSequenceStateSafe({ last_value: "9", max_id: "8", is_called: false }), true);
  assert.equal(isSequenceStateSafe({ last_value: "1", max_id: null, is_called: false }), true);
});

test("snapshot rehearsal permits live source sequence advancement but cutover requires exact sequence state", () => {
  const source = { last_value: "25", max_id: "20", is_called: true };
  const imported = { last_value: "20", max_id: "20", is_called: true };
  assert.equal(areSequenceStatesCompatible(source, imported), false);
  assert.equal(areSequenceStatesCompatible(source, imported, true), true);
  assert.equal(areSequenceStatesCompatible(source, { ...imported, last_value: "19" }, true), false);
  assert.equal(areSequenceStatesCompatible(source, { ...imported, max_id: "21" }, true), false);
});

test("target admin audit sequence must remain unused during data import", () => {
  assert.equal(isSequenceUnused({ last_value: "1", is_called: false }), true);
  assert.equal(isSequenceUnused({ last_value: "1", is_called: true }), false);
  assert.equal(isSequenceUnused({ last_value: "2", is_called: false }), false);
});

test("target comparison treats a legacy source without is_enabled as enabled and compares an existing flag", () => {
  assert.match(getTargetsSourceProjection(false), /t\.headers, true/);
  assert.match(getTargetsSourceProjection(true), /t\.headers, t\.is_enabled/);
});

test("target host allowlist requires every valid HTTPS target hostname and a nonempty allowlist", () => {
  const targets = [
    { url: "https://example.invalid/health", is_enabled: true },
    { url: "https://api.example.invalid/status", is_enabled: true },
  ];
  assert.equal(isTargetHostAllowlistComplete(targets, new Set(["example.invalid", "api.example.invalid"])), true);
  assert.equal(isTargetHostAllowlistComplete(targets, new Set(["example.invalid"])), false);
  assert.equal(isTargetHostAllowlistComplete(targets, new Set()), false);
  assert.equal(isTargetHostAllowlistComplete([{ url: "https://user@example.invalid/", is_enabled: true }], new Set(["example.invalid"])), false);
  assert.equal(isTargetHostAllowlistComplete([{ url: "http://example.invalid/", is_enabled: true }], new Set(["example.invalid"])), false);
  assert.equal(isTargetHostAllowlistComplete([{ url: `https://example.invalid/${"x".repeat(2048)}`, is_enabled: true }], new Set(["example.invalid"])), false);
  assert.equal(isTargetHostAllowlistComplete([{ url: "https://not-allowed.invalid/", is_enabled: false }], new Set(["example.invalid"])), true);
});
