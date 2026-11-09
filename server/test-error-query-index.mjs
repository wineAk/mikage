import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const testId = randomUUID();
const containerName = `mikage-error-index-${testId.slice(0, 8)}`;
const labelName = "mikage.error-index-test";
let hasCreatedContainer = false;

function runDocker(argumentsList, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", argumentsList, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { errors += chunk; });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve(output.trim()) : reject(new Error(`隔離DB検証に失敗しました (${code}): ${errors}`)));
    child.stdin.end(input);
  });
}

function runSql(sql) {
  return runDocker(["exec", "-i", containerName, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "error_test"], sql);
}

async function measureFunction() {
  const samples = [];
  for (let index = 0; index < 5; index++) {
    const [plan] = JSON.parse(await runSql("SET ROLE anon; EXPLAIN (ANALYZE, FORMAT JSON) SELECT mikage.get_error_logs(0,-1);"));
    samples.push(plan["Execution Time"]);
  }
  return { samples, median: [...samples].sort((first, second) => first - second)[2], max: Math.max(...samples) };
}

try {
  await runDocker(["run", "--detach", "--name", containerName, "--label", `${labelName}=${testId}`, "--network", "none", "--tmpfs", "/var/lib/postgresql/data", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", "POSTGRES_DB=error_test", "postgres:17-alpine"]);
  hasCreatedContainer = true;
  let isReady = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { await runDocker(["exec", containerName, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "error_test"]); isReady = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert.ok(isReady);
  const schema = JSON.parse(await readFile("performance-database-before-schema.json", "utf8"));
  const definition = schema.functions.find(item => item.name === "get_error_logs").definition;
  const logsDefinition = schema.functions.find(item => item.name === "get_logs_in_range").definition;
  await runSql(`
    CREATE ROLE anon NOLOGIN;
    CREATE SCHEMA mikage;
    CREATE TABLE mikage.targets(key text PRIMARY KEY, name text);
    CREATE TABLE mikage.logs(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, target_key text, created_at timestamptz, response_time numeric, status_code integer, status_message text, error_name text, error_code text);
    INSERT INTO mikage.targets VALUES ('example-one','Example One'),('example-two','Example Two');
    INSERT INTO mikage.logs(target_key,created_at,response_time,status_code,error_code)
    SELECT 'example-one',current_timestamp-make_interval(mins=>value),100,CASE WHEN value%1000=0 THEN 503 ELSE 200 END,NULL
    FROM generate_series(1,280000) AS source(value);
    INSERT INTO mikage.logs(target_key,created_at,response_time,status_code,status_message,error_name,error_code)
    SELECT target_key,
      date_trunc('month',current_timestamp+interval '9 hours')-interval '9 hours'+make_interval(months=>month_offset)+boundary_offset+row_number() OVER() * interval '1 microsecond',
      0,status_code,'Example message','Example error',error_code
    FROM (VALUES ('example-one'),('example-two'),('example-orphan')) AS targets(target_key)
    CROSS JOIN (VALUES (200),(503),(NULL::integer)) AS statuses(status_code)
    CROSS JOIN (VALUES (NULL::text),('NO_INTERNET'),('EXAMPLE_ERROR')) AS errors(error_code)
    CROSS JOIN (VALUES (-1),(0),(1)) AS months(month_offset)
    CROSS JOIN (VALUES (interval '0 seconds'),(interval '-1 second')) AS boundaries(boundary_offset);
    CREATE INDEX idx_logs_created_at ON mikage.logs(created_at);
    CREATE INDEX idx_logs_target_key ON mikage.logs(target_key);
    CREATE INDEX idx_logs_target_key_created_at ON mikage.logs(target_key,created_at);
    ALTER TABLE mikage.logs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE mikage.targets ENABLE ROW LEVEL SECURITY;
    CREATE POLICY open_read ON mikage.logs FOR SELECT TO anon USING(true);
    CREATE POLICY open_read ON mikage.targets FOR SELECT TO anon USING(true);
    GRANT USAGE ON SCHEMA mikage TO anon;
    GRANT SELECT ON ALL TABLES IN SCHEMA mikage TO anon;
    ${definition};
    ${logsDefinition};
    ANALYZE mikage.logs;
  `);
  const cases = [[0,-1],[1,0],[2,1],[12,11],[0,0],[0,1],[null,-1],[0,null]];
  const timezones = ["UTC", "Asia/Tokyo", "America/Los_Angeles"];
  const snapshots = [];
  for (const timezone of timezones) {
    for (const [start, end] of cases) {
      const query = `SET TIME ZONE '${timezone}'; SET ROLE anon; SELECT md5(mikage.get_error_logs(${start ?? "NULL"},${end ?? "NULL"})::text);`;
      snapshots.push({ timezone, start, end, query, hash: await runSql(query) });
    }
  }
  const before = await measureFunction();
  await runSql(await readFile("sql/error-logs-optimized.sql", "utf8"));
  const indexState = await runSql("SELECT indisvalid AND indisready FROM pg_index WHERE indexrelid='mikage.idx_logs_error_created_at'::regclass;");
  assert.equal(indexState, "t");
  for (const snapshot of snapshots) assert.equal(await runSql(snapshot.query), snapshot.hash, `結果が変化しました: ${snapshot.timezone} ${snapshot.start}/${snapshot.end}`);
  const after = await measureFunction();
  const body = definition.match(/AS \$function\$([\s\S]*)\$function\$/)[1].replace(/\bstart_offset\b/g, "0").replace(/\bend_offset\b/g, "(-1)");
  const plan = JSON.parse(await runSql(`SET ROLE anon; EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${body};`));
  assert.match(JSON.stringify(plan), /idx_logs_error_created_at/);
  const functionStateSql = `SELECT jsonb_agg(jsonb_build_object('name',proname,'hash',encode(sha256(convert_to(prosrc,'UTF8')),'hex'),'volatility',provolatile,'configuration',proconfig,'acl',proacl,'securityDefiner',prosecdef) ORDER BY proname) FROM pg_proc WHERE oid IN ('mikage.get_error_logs(integer,integer)'::regprocedure,'mikage.get_logs_in_range(text[],timestamp without time zone,timestamp without time zone)'::regprocedure);`;
  const functionsBefore = JSON.parse(await runSql(functionStateSql));
  assert.ok(functionsBefore.every(item => item.volatility === "v"));
  const auditedRpcChecks = ["原本RPCはVOLATILEで開始する"];
  const auditedMigration = await readFile("sql/page-cache-audited-rpcs.sql", "utf8");
  await runSql(auditedMigration);
  const functionsAfter = JSON.parse(await runSql(functionStateSql));
  assert.ok(functionsAfter.every(item => item.volatility === "s"));
  auditedRpcChecks.push("変更前後の結果比較を含むmigrationが完了し両RPCがSTABLEになる");
  for (const [index, item] of functionsAfter.entries()) {
    assert.equal(item.hash, functionsBefore[index].hash);
    assert.deepEqual(item.acl, functionsBefore[index].acl);
    assert.equal(item.securityDefiner, functionsBefore[index].securityDefiner);
    assert.ok(item.configuration.includes("TimeZone=UTC"));
    assert.ok(item.configuration.includes("DateStyle=ISO, MDY"));
  }
  auditedRpcChecks.push("関数本文・権限・security invokerを維持する", "両RPCのTimeZoneとDateStyleを固定する");
  await runSql(auditedMigration);
  assert.deepEqual(JSON.parse(await runSql(functionStateSql)), functionsAfter);
  auditedRpcChecks.push("同じmigrationを再適用しても状態を変えず成功する");
  await runSql("ALTER FUNCTION mikage.get_error_logs(integer,integer) SET TimeZone TO 'Asia/Tokyo';");
  const beforeMismatch = await runSql(functionStateSql);
  await assert.rejects(runSql(auditedMigration), /RPCの変更前後で結果が一致しない/);
  assert.equal(await runSql(functionStateSql), beforeMismatch);
  auditedRpcChecks.push("日時設定で結果が変わる既存状態は全変更をrollbackする");
  await runSql("ALTER FUNCTION mikage.get_error_logs(integer,integer) SET TimeZone TO 'UTC'; CREATE OR REPLACE FUNCTION mikage.get_error_logs(start_offset integer,end_offset integer) RETURNS jsonb LANGUAGE sql VOLATILE AS $$SELECT '{}'::jsonb;$$;");
  const beforeSourceMismatch = await runSql(functionStateSql);
  await assert.rejects(runSql(auditedMigration), /監査したRPC本文と一致しない/);
  assert.equal(await runSql(functionStateSql), beforeSourceMismatch);
  auditedRpcChecks.push("監査本文と異なるRPCは拒否し全変更をrollbackする");
  const results = { measuredAt: new Date().toISOString(), database: "isolated-postgres-17", productionDatabaseTouched: false, passed: snapshots.length + 2 + auditedRpcChecks.length, compatibleCases: snapshots.length, indexValid: true, indexUsed: true, before, after, auditedRpcChecks };
  await writeFile("performance-error-index-isolated.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  if (hasCreatedContainer) {
    const label = await runDocker(["inspect", "--format", `{{ index .Config.Labels "${labelName}" }}`, containerName]);
    assert.equal(label, testId);
    await runDocker(["rm", "--force", containerName]);
  }
}
