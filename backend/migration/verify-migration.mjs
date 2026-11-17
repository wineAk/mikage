const pageSize = 1_000;

const tableSpecs = [
  {
    name: "targets",
    key: "key",
    keyType: "text",
    rowJson: "jsonb_build_array(t.key, t.name, t.url, t.headers, t.is_enabled)::text",
    rowJsonWithoutSourceEnabled: "jsonb_build_array(t.key, t.name, t.url, t.headers, true)::text",
  },
  { name: "logs", key: "id", keyType: "integer", rowJson: "to_jsonb(t)::text" },
  { name: "incidents", key: "id", keyType: "bigint", rowJson: "(to_jsonb(t) - 'notification_pending')::text" },
  {
    name: "watch_target_states",
    key: "target_key",
    keyType: "text",
    rowJson: "to_jsonb(t)::text",
  },
];

function migrationError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function assertSourceWritesFrozen(value) {
  if (value !== "true") throw migrationError("MIGRATION_SOURCE_NOT_FROZEN", "source writer freeze acknowledgement is required");
}

export function isValidExportedSnapshotId(value) {
  return typeof value === "string" && /^[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+$/.test(value);
}

export function assertSourceConsistencyMode(writesFrozen, snapshotId) {
  if (snapshotId && !isValidExportedSnapshotId(snapshotId)) {
    throw migrationError("MIGRATION_SOURCE_SNAPSHOT_INVALID", "source snapshot identifier is invalid");
  }
  if (writesFrozen === "true" || isValidExportedSnapshotId(snapshotId)) return;
  throw migrationError("MIGRATION_SOURCE_NOT_FROZEN", "stop source writers or provide a live exported snapshot");
}

export function buildSetSnapshotStatement(snapshotId) {
  if (!isValidExportedSnapshotId(snapshotId)) {
    throw migrationError("MIGRATION_SOURCE_SNAPSHOT_INVALID", "source snapshot identifier is invalid");
  }
  return `SET TRANSACTION SNAPSHOT '${snapshotId}'`;
}

export function assertSourceRoleCanReadAllRows(roleState) {
  if (!roleState || (roleState.rolsuper !== true && roleState.rolbypassrls !== true)) {
    throw migrationError("MIGRATION_SOURCE_RLS_BYPASS", "source role cannot bypass row-level security");
  }
}

export function comparePageRows(sourceRows, targetRows) {
  if (sourceRows.length !== targetRows.length) return false;
  return sourceRows.every((row, index) =>
    row.cursor === targetRows[index].cursor && row.row_hash === targetRows[index].row_hash
  );
}

export function isSequenceStateSafe(sequenceState) {
  if (sequenceState.max_id === null) return true;
  const lastValue = BigInt(sequenceState.last_value);
  const maxId = BigInt(sequenceState.max_id);
  return lastValue > maxId || (lastValue === maxId && sequenceState.is_called);
}

export function isSequenceUnused(sequenceState) {
  return BigInt(sequenceState.last_value) === 1n && !sequenceState.is_called;
}

export function areSequenceStatesCompatible(sourceState, targetState, allowSourceAdvance = false) {
  if (!isSequenceStateSafe(sourceState) || !isSequenceStateSafe(targetState)) return false;
  if (allowSourceAdvance) return true;
  return sourceState.last_value === targetState.last_value
    && sourceState.is_called === targetState.is_called
    && sourceState.max_id === targetState.max_id;
}

const requiredTables = [
  "targets", "logs", "incidents", "watch_scheduler_lock", "watch_target_states",
  "watch_result_batches", "page_cache_revision", "target_change_audit", "incident_transition_batches",
];
const transferredTables = new Set(["targets", "logs", "incidents", "watch_target_states"]);
const transferredSequences = new Set(["logs_id_seq", "incidents_id_seq"]);
const transferredIndexes = new Set([
  "targets_pkey", "logs_pkey", "incidents_pkey", "watch_target_states_pkey",
  "idx_logs_created_at", "idx_logs_target_key", "idx_logs_target_key_created_at", "idx_logs_error_created_at",
]);
const requiredSequences = ["logs_id_seq", "incidents_id_seq", "target_change_audit_id_seq"];
const requiredFunctions = ["bump_page_cache_revision"];
const requiredIndexes = [
  "targets_pkey", "logs_pkey", "incidents_pkey", "watch_scheduler_lock_pkey",
  "watch_target_states_pkey", "watch_result_batches_pkey", "page_cache_revision_pkey",
  "target_change_audit_pkey", "incident_transition_batches_pkey", "idx_logs_created_at",
  "idx_logs_target_key", "idx_logs_target_key_created_at", "idx_logs_error_created_at",
];
const requiredTriggers = ["page_cache_revision_logs", "page_cache_revision_targets", "page_cache_revision_incidents"];
const requiredContractKeys = [
  ...requiredTables.map((name) => `table:${name}`),
  ...requiredSequences.map((name) => `sequence:${name}`),
  ...requiredFunctions.map((name) => `function:${name}`),
  ...requiredTables.map((name) => `columns:${name}`),
  ...requiredTables.map((name) => `constraints:${name}`),
  ...requiredIndexes.map((name) => `index:${name}`),
  ...requiredTriggers.map((name) => `trigger:${name}`),
];

export const schemaContractQuery = `
  WITH required_tables(name) AS (SELECT unnest($1::text[])),
  required_sequences(name) AS (SELECT unnest($2::text[])),
  required_functions(name) AS (SELECT unnest($3::text[])),
  required_indexes(name) AS (SELECT unnest($4::text[])),
  required_triggers(name) AS (SELECT unnest($5::text[])),
  actual_columns AS (
    SELECT table_name,
           jsonb_agg(jsonb_build_array(column_name, data_type, is_nullable, column_default, is_identity, identity_generation) ORDER BY ordinal_position) AS definition
    FROM information_schema.columns
    WHERE table_schema='mikage'
      AND table_name IN ('targets','logs','incidents','watch_scheduler_lock','watch_target_states','watch_result_batches','page_cache_revision','target_change_audit','incident_transition_batches')
    GROUP BY table_name
  ),
  actual_constraints AS (
    SELECT conrelid::regclass::text AS table_name,
           jsonb_agg(jsonb_build_array(conname, contype, pg_get_constraintdef(oid, true)) ORDER BY conname) AS definition
    FROM pg_constraint
    WHERE connamespace='mikage'::regnamespace
      AND conrelid IN (SELECT to_regclass('mikage.' || name) FROM required_tables)
    GROUP BY conrelid
  ),
  actual_indexes AS (
    SELECT indexrelid::regclass::text AS name, pg_get_indexdef(indexrelid) AS definition
    FROM pg_index WHERE indrelid IN (SELECT to_regclass('mikage.' || name) FROM required_tables)
  ),
  actual_triggers AS (
    SELECT tgname AS name, pg_get_triggerdef(oid, true) AS definition
    FROM pg_trigger
    WHERE NOT tgisinternal AND tgrelid IN (SELECT to_regclass('mikage.' || name) FROM required_tables)
  ),
  actual_functions AS (
    SELECT proname AS name, pg_get_functiondef(oid) AS definition
    FROM pg_proc
    WHERE pronamespace='mikage'::regnamespace
      AND proname IN (SELECT name FROM required_functions)
      AND pg_get_function_identity_arguments(oid)=''
  ),
  contract AS (
    SELECT 'table' AS kind, r.name, (c.oid IS NOT NULL)::text AS definition
      FROM required_tables r LEFT JOIN pg_class c ON c.relnamespace='mikage'::regnamespace AND c.relname=r.name AND c.relkind IN ('r','p')
    UNION ALL
    SELECT 'sequence', r.name, (c.oid IS NOT NULL)::text
      FROM required_sequences r LEFT JOIN pg_class c ON c.relnamespace='mikage'::regnamespace AND c.relname=r.name AND c.relkind='S'
    UNION ALL
    SELECT 'function', r.name, COALESCE(f.definition, 'missing')
      FROM required_functions r LEFT JOIN actual_functions f ON f.name=r.name
    UNION ALL
    SELECT 'columns', r.name, CASE WHEN r.name IN ('targets','logs','incidents','watch_target_states') THEN COALESCE(c.definition::text, 'missing') ELSE 'present' END
      FROM required_tables r LEFT JOIN actual_columns c ON c.table_name=r.name
    UNION ALL
    SELECT 'constraints', r.name, COALESCE(c.definition::text, '[]') FROM required_tables r LEFT JOIN actual_constraints c ON c.table_name='mikage.' || r.name
    UNION ALL
    SELECT 'index', r.name, COALESCE(i.definition, 'missing') FROM required_indexes r LEFT JOIN actual_indexes i ON i.name='mikage.' || r.name
    UNION ALL
    SELECT 'trigger', r.name, COALESCE(t.definition, 'missing') FROM required_triggers r LEFT JOIN actual_triggers t ON t.name=r.name
  )
  SELECT kind, name, definition FROM contract ORDER BY kind, name
`;

export function compareSchemaContracts(sourceRows, targetRows) {
  const normalizeRows = (rows) => rows.map((row) => {
    if (row.kind !== "columns" || !["targets", "incidents"].includes(row.name)) return row;
    try {
      const destinationOnlyColumns = row.name === "targets" ? ["is_enabled"] : ["notification_pending"];
      return { ...row, definition: JSON.stringify(JSON.parse(row.definition)
        .filter((column) => !destinationOnlyColumns.includes(column[0]))) };
    } catch {
      return row;
    }
  });
  const normalizedSourceRows = normalizeRows(sourceRows);
  const normalizedTargetRows = normalizeRows(targetRows);
  const sourceMap = new Map(normalizedSourceRows.map((row) => [`${row.kind}:${row.name}`, row.definition]));
  const targetMap = new Map(normalizedTargetRows.map((row) => [`${row.kind}:${row.name}`, row.definition]));
  if (sourceMap.size !== sourceRows.length || targetMap.size !== targetRows.length) return false;
  if (requiredContractKeys.some((key) => !targetMap.has(key))) return false;
  for (const [key, targetDefinition] of targetMap) {
    if (targetDefinition === "missing" || targetDefinition === "false") return false;
    const [kind, name] = key.split(":");
    const sourceComparable = kind === "table" || kind === "columns"
      ? transferredTables.has(name)
      : kind === "constraints"
        ? transferredTables.has(name.replace(/^mikage\./, ""))
        : kind === "sequence"
          ? transferredSequences.has(name)
          : kind === "index"
            ? transferredIndexes.has(name)
            : false;
    if (!sourceComparable) continue;
    const sourceDefinition = sourceMap.get(key);
    if (sourceDefinition === undefined || sourceDefinition === "missing" || sourceDefinition === "false" || sourceDefinition !== targetDefinition) return false;
  }
  return true;
}

async function readSchemaContract(client) {
  const { rows } = await client.query(schemaContractQuery, [requiredTables, requiredSequences, requiredFunctions, requiredIndexes, requiredTriggers]);
  return rows;
}

export function getTargetsSourceProjection(sourceHasEnabled) {
  const targetsTable = tableSpecs.find(({ name }) => name === "targets");
  return sourceHasEnabled ? targetsTable.rowJson : targetsTable.rowJsonWithoutSourceEnabled;
}

export function isTargetHostAllowlistComplete(targetRows, allowedHosts) {
  if (allowedHosts.size === 0) return false;
  return targetRows.filter((row) => row.is_enabled).every((row) => {
    if (typeof row.url !== "string" || row.url.length > 2048) return false;
    try {
      const targetUrl = new URL(row.url);
      return targetUrl.protocol === "https:" && !targetUrl.username && !targetUrl.password && !targetUrl.hash && allowedHosts.has(targetUrl.hostname.toLowerCase().replace(/\.$/, ""));
    } catch {
      return false;
    }
  });
}

async function countRows(client, tableName) {
  const { rows } = await client.query(`SELECT count(*)::text AS count FROM mikage.${tableName}`);
  return rows[0].count;
}

export function buildPageQuery(table, rowJson = table.rowJson) {
  const keyExpression = table.keyType === "text"
    ? `t.${table.key} COLLATE "C"`
    : `t.${table.key}`;
  const cursorExpression = table.keyType === "text"
    ? `$1::text COLLATE "C"`
    : `$1::${table.keyType}`;

  return `SELECT ${keyExpression}::text AS cursor,
            md5(${rowJson}) AS row_hash
       FROM mikage.${table.name} AS t
      WHERE $1::${table.keyType} IS NULL OR ${keyExpression} > ${cursorExpression}
      ORDER BY ${keyExpression}
      LIMIT $2`;
}

async function fetchPage(client, table, cursor, rowJson = table.rowJson) {
  const { rows } = await client.query(buildPageQuery(table, rowJson), [cursor, pageSize]);
  return rows;
}

async function verifyTable(source, target, table, sourceRowJson = table.rowJson) {
  const [sourceCount, targetCount] = await Promise.all([
    countRows(source, table.name),
    countRows(target, table.name),
  ]);
  if (sourceCount !== targetCount) throw new Error(`${table.name}: row counts differ`);

  let cursor = null;
  let verifiedRows = 0;
  while (true) {
    const [sourceRows, targetRows] = await Promise.all([
      fetchPage(source, table, cursor, sourceRowJson),
      fetchPage(target, table, cursor),
    ]);
    if (!comparePageRows(sourceRows, targetRows)) {
      throw new Error(`${table.name}: row values differ`);
    }
    if (sourceRows.length === 0) break;
    verifiedRows += sourceRows.length;
    cursor = sourceRows.at(-1).cursor;
  }

  console.log(`${table.name}: rows verified`);
}

export function createSourcePool(Pool) {
  const required = [
    "MIKAGE_SOURCE_PGHOST",
    "MIKAGE_SOURCE_PGUSER",
    "MIKAGE_SOURCE_PGPASSWORD",
  ];
  for (const name of required) {
    if (!process.env[name]) throw migrationError("MIGRATION_SOURCE_CONFIG", "source connection settings are incomplete");
  }

  const sslmode = process.env.MIKAGE_SOURCE_PGSSLMODE ?? "verify-full";
  if (sslmode !== "verify-full" || !process.env.MIKAGE_SOURCE_PGSSLROOTCERT_BASE64) {
    throw migrationError("MIGRATION_SOURCE_TLS_CONFIG", "source TLS certificate verification is required");
  }
  const ca = Buffer.from(process.env.MIKAGE_SOURCE_PGSSLROOTCERT_BASE64, "base64").toString("utf8");
  if (!ca.includes("-----BEGIN CERTIFICATE-----")) {
    throw migrationError("MIGRATION_SOURCE_CA_INVALID", "source root certificate is invalid");
  }

  return new Pool({
    host: process.env.MIKAGE_SOURCE_PGHOST,
    port: Number(process.env.MIKAGE_SOURCE_PGPORT ?? 5432),
    user: process.env.MIKAGE_SOURCE_PGUSER,
    password: process.env.MIKAGE_SOURCE_PGPASSWORD,
    database: process.env.MIKAGE_SOURCE_PGDATABASE ?? "postgres",
    ssl: { ca, rejectUnauthorized: true },
    max: 1,
    connectionTimeoutMillis: 10_000,
    application_name: "mikage-migration-verifier",
  });
}

async function runVerification({ schemaOnly = false } = {}) {
  const snapshotId = process.env.MIKAGE_SOURCE_SNAPSHOT_ID ?? "";
  if (!schemaOnly) assertSourceConsistencyMode(process.env.MIKAGE_SOURCE_WRITES_FROZEN, snapshotId);
  const { Pool } = await import("pg");
  const sourcePool = createSourcePool(Pool);
  const targetPool = new Pool({
    max: 1,
    connectionTimeoutMillis: 10_000,
    application_name: "mikage-migration-verifier",
  });
  let source;
  let target;

  try {
    source = await sourcePool.connect();
    target = await targetPool.connect();
    await Promise.all([source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"), target.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")]);
    if (snapshotId && !schemaOnly) {
      await source.query(buildSetSnapshotStatement(snapshotId));
    }
    await Promise.all([source.query("SET LOCAL TIME ZONE 'UTC'"), target.query("SET LOCAL TIME ZONE 'UTC'")]);
    const sourceRole = await source.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
    assertSourceRoleCanReadAllRows(sourceRole.rows[0]);

    const [sourceSchema, targetSchema] = await Promise.all([readSchemaContract(source), readSchemaContract(target)]);
    if (!compareSchemaContracts(sourceSchema, targetSchema)) {
      throw migrationError("MIGRATION_SCHEMA_MISMATCH", "source and target application schema contracts differ");
    }
    if (schemaOnly) {
      const migrationState = await target.query(
        "SELECT data_verified, verified_at FROM mikage.migration_state WHERE singleton = true"
      );
      if (migrationState.rowCount !== 1 || migrationState.rows[0].data_verified || migrationState.rows[0].verified_at !== null) {
        throw migrationError("MIGRATION_RUNTIME_ALREADY_ENABLED", "destination migration gate is not in its initial state");
      }
      await Promise.all([source.query("COMMIT"), target.query("COMMIT")]);
      console.log("Migration schema contract passed; no row data was read.");
      return;
    }

    const sourceHasEnabled = await source.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='mikage' AND table_name='targets' AND column_name='is_enabled'
      ) AS present
    `);
    const targetHasEnabled = await target.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='mikage' AND table_name='targets' AND column_name='is_enabled'
      ) AS present
    `);
    if (!targetHasEnabled.rows[0].present) throw new Error("target schema is missing targets.is_enabled");

    for (const table of tableSpecs) {
      const sourceRowJson = table.name === "targets" && !sourceHasEnabled.rows[0].present
        ? getTargetsSourceProjection(false)
        : table.rowJson;
      await verifyTable(source, target, table, sourceRowJson);
    }

    const allowedTargetHosts = new Set((process.env.MIKAGE_TARGET_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean));
    if (allowedTargetHosts.size === 0) throw migrationError("MIGRATION_TARGET_HOST_ALLOWLIST", "target host allowlist is incomplete");
    const sourceTargetProjection = sourceHasEnabled.rows[0].present ? "url, is_enabled" : "url, true AS is_enabled";
    const targetUrls = await Promise.all([
      source.query(`SELECT ${sourceTargetProjection} FROM mikage.targets`),
      target.query("SELECT url, is_enabled FROM mikage.targets"),
    ]);
    if (targetUrls.some(({ rows }) => !isTargetHostAllowlistComplete(rows, allowedTargetHosts))) {
      throw migrationError("MIGRATION_TARGET_HOST_ALLOWLIST", "target host allowlist is incomplete");
    }

    const checks = await target.query(`
      SELECT
        (SELECT count(*) FROM mikage.watch_scheduler_lock) AS scheduler_lock_rows,
        (SELECT count(*) FROM mikage.watch_result_batches) AS watch_result_batch_rows,
        (SELECT count(*) FROM mikage.incident_transition_batches) AS incident_transition_batch_rows,
        (SELECT count(*) FROM mikage.target_change_audit) AS target_change_audit_rows,
        (SELECT count(*) FROM mikage.page_cache_revision) AS page_revision_rows,
        (SELECT count(*) FROM mikage.page_cache_revision WHERE singleton) AS page_revision_singletons,
        (SELECT count(*) FROM mikage.migration_state) AS migration_state_rows,
        (SELECT count(*) FROM mikage.migration_state WHERE singleton AND ((NOT data_verified AND verified_at IS NULL) OR (data_verified AND verified_at IS NOT NULL))) AS migration_state_valid_rows,
        (SELECT count(*) FROM mikage.logs AS logs LEFT JOIN mikage.targets AS targets ON targets.key=logs.target_key WHERE targets.key IS NULL) AS log_orphans,
        (SELECT count(*) FROM mikage.watch_target_states AS states LEFT JOIN mikage.targets AS targets ON targets.key=states.target_key WHERE targets.key IS NULL) AS state_orphans
    `);
    const row = checks.rows[0];

    const sequenceChecks = await Promise.all([
      ["logs_id_seq", "mikage.logs_id_seq"],
      ["incidents_id_seq", "mikage.incidents_id_seq"],
    ].map(async ([name, sequenceName]) => {
      const [sourceSequence, targetSequence] = await Promise.all([
        source.query(`SELECT last_value::text AS last_value, is_called, (SELECT max(id)::text FROM mikage.${name.replace("_id_seq", "")}) AS max_id FROM ${sequenceName}`),
        target.query(`SELECT last_value::text AS last_value, is_called, (SELECT max(id)::text FROM mikage.${name.replace("_id_seq", "")}) AS max_id FROM ${sequenceName}`),
      ]);
      const sourceState = sourceSequence.rows[0];
      const targetState = targetSequence.rows[0];
      return areSequenceStatesCompatible(sourceState, targetState, Boolean(snapshotId));
    }));
    const targetAuditSequence = await target.query(
      "SELECT last_value::text AS last_value, is_called FROM mikage.target_change_audit_id_seq"
    );
    if (
      row.scheduler_lock_rows !== "0" ||
      row.watch_result_batch_rows !== "0" ||
      row.incident_transition_batch_rows !== "0" ||
      row.target_change_audit_rows !== "0" ||
      row.page_revision_rows !== "1" ||
      row.page_revision_singletons !== "1" ||
      row.migration_state_rows !== "1" ||
      row.migration_state_valid_rows !== "1" ||
      !isSequenceUnused(targetAuditSequence.rows[0]) ||
      sequenceChecks.some((matches) => !matches) ||
      row.log_orphans !== "0" || row.state_orphans !== "0"
    ) {
      throw new Error("target auxiliary state, sequence, or foreign key checks failed");
    }

    await Promise.all([source.query("COMMIT"), target.query("COMMIT")]);
    const verified = await target.query(
      "UPDATE mikage.migration_state SET data_verified = true, verified_at = clock_timestamp() WHERE singleton = true RETURNING singleton"
    );
    if (verified.rowCount !== 1) throw migrationError("MIGRATION_RUNTIME_GATE_UPDATE", "destination migration gate could not be enabled");
    console.log("Migration verification passed; row contents were compared without printing database values.");
  } catch (error) {
    await Promise.allSettled([
      source?.query("ROLLBACK"),
      target?.query("ROLLBACK"),
    ].filter(Boolean));
    throw error;
  } finally {
    source?.release();
    target?.release();
    await Promise.allSettled([sourcePool.end(), targetPool.end()]);
  }
}

if (process.argv[1]?.endsWith("verify-migration.mjs")) {
  try {
    await runVerification({ schemaOnly: process.argv.includes("--schema-only") });
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "verification_failed";
    console.error(`Migration verification failed (${code}); connection and row values were not logged.`);
    process.exitCode = 1;
  }
}
