import dotenv from "dotenv";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

dotenv.config({ quiet: true });
if (!process.env.DATABASE_URL) throw new Error("server/.env の DATABASE_URL が未設定です。");
let connectionEnvironment;
try {
  const databaseUrl = new URL(process.env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) throw new Error();
  // PGDATABASE環境変数のURLはconninfoとして展開されないため、各項目を分ける。
  // パスワードをプロセスのコマンドラインへ渡さない。
  connectionEnvironment = {
    ...process.env,
    PGHOST: decodeURIComponent(databaseUrl.hostname.replace(/^\[|\]$/g, "")),
    PGPORT: databaseUrl.port || "5432",
    PGUSER: decodeURIComponent(databaseUrl.username),
    PGPASSWORD: decodeURIComponent(databaseUrl.password),
    PGDATABASE: decodeURIComponent(databaseUrl.pathname.slice(1)) || "postgres",
    PGCONNECT_TIMEOUT: "10",
  };
  const connectionOptions = {
    sslmode: "PGSSLMODE", sslrootcert: "PGSSLROOTCERT", sslcert: "PGSSLCERT",
    sslkey: "PGSSLKEY", channel_binding: "PGCHANNELBINDING",
    application_name: "PGAPPNAME", options: "PGOPTIONS",
    target_session_attrs: "PGTARGETSESSIONATTRS", gssencmode: "PGGSSENCMODE",
  };
  for (const [name, value] of databaseUrl.searchParams) {
    if (name === "connect_timeout") continue;
    if (!Object.hasOwn(connectionOptions, name)) throw new Error();
    connectionEnvironment[connectionOptions[name]] = value;
  }
} catch {
  throw new Error("DATABASE_URL の形式または接続オプションを確認してください。");
}
const mode = process.argv[2] ?? "inspect";
let sql;
if (mode === "inspect") {
  sql = `BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT json_build_object(
  'functions', (SELECT json_agg(json_build_object('name', p.proname, 'arguments', pg_get_function_arguments(p.oid), 'definition', pg_get_functiondef(p.oid), 'volatility', p.provolatile, 'securityDefiner', p.prosecdef)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='mikage' AND p.proname IN ('get_logs_in_range','get_error_logs','get_page_cache_revision')),
  'indexes', (SELECT json_agg(json_build_object('table', tablename, 'name', indexname, 'definition', indexdef)) FROM pg_indexes WHERE schemaname='mikage' AND tablename IN ('logs','targets','incidents')),
  'tables', (SELECT json_agg(json_build_object('name', c.relname, 'estimatedRows', c.reltuples, 'bytes', pg_total_relation_size(c.oid), 'rls', c.relrowsecurity)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mikage' AND c.relname IN ('logs','targets','incidents')),
  'policies', (SELECT json_agg(json_build_object('table', tablename, 'name', policyname, 'permissive', permissive, 'roles', roles, 'command', cmd, 'using', qual)) FROM pg_policies WHERE schemaname='mikage' AND tablename IN ('logs','targets','incidents'))
); ROLLBACK;`;
} else if (mode === "apply-page-cache") {
  sql = await readFile("sql/page-cache-snapshot.sql", "utf8");
} else if (mode === "apply-error-index") {
  sql = "SET lock_timeout = '5s'; SET statement_timeout = '120s';\n" + await readFile("sql/error-logs-optimized.sql", "utf8");
} else if (mode === "apply-audited-rpcs") {
  sql = await readFile("sql/page-cache-audited-rpcs.sql", "utf8");
} else if (mode === "diagnose-cache") {
  sql = `BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT json_build_object(
  'settings', (SELECT json_object_agg(name, setting) FROM pg_settings WHERE lower(name) IN ('timezone','datestyle','intervalstyle','extra_float_digits','server_version_num')),
  'roleSettings', (SELECT json_agg(json_build_object('role', role.rolname, 'settings', ARRAY(SELECT item FROM unnest(role.rolconfig) item WHERE lower(split_part(item,'=',1)) IN ('timezone','datestyle','intervalstyle','extra_float_digits','pgrst.db_pre_request')))) FROM pg_roles role WHERE role.rolname IN ('anon','authenticated','authenticator')),
  'databaseSettings', (SELECT json_agg(json_build_object('role', COALESCE(role.rolname,'all'), 'settings', ARRAY(SELECT item FROM unnest(config.setconfig) item WHERE lower(split_part(item,'=',1)) IN ('timezone','datestyle','intervalstyle','extra_float_digits','pgrst.db_pre_request')))) FROM pg_db_role_setting config LEFT JOIN pg_roles role ON role.oid=config.setrole WHERE config.setdatabase IN (0,(SELECT oid FROM pg_database WHERE datname=current_database()))),
  'columnTypes', (SELECT json_agg(json_build_object('table',table_name,'column',column_name,'type',data_type)) FROM information_schema.columns WHERE table_schema='mikage' AND table_name IN ('logs','targets','incidents')),
  'indexStatus', (SELECT json_agg(json_build_object('name',c.relname,'valid',i.indisvalid,'ready',i.indisready,'bytes',pg_relation_size(c.oid))) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mikage' AND c.relname='idx_logs_error_created_at'),
  'functions', (SELECT json_agg(json_build_object('name',p.proname,'settings',p.proconfig,'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='mikage' AND p.proname IN ('get_error_logs','get_logs_in_range','get_page_cache_revision'))
); ROLLBACK;`;
} else {
  throw new Error("指定できる処理は inspect / diagnose-cache / apply-error-index / apply-audited-rpcs / apply-page-cache です。");
}

const child = spawn("psql", ["-X", "--no-psqlrc", "--no-password", "--tuples-only", "--no-align", "-v", "ON_ERROR_STOP=1"], {
  env: connectionEnvironment,
  windowsHide: true,
  timeout: mode === "apply-error-index" ? 180_000 : 30_000,
  stdio: ["pipe", "pipe", "pipe"],
});
let output = "";
let errors = "";
child.stdout.on("data", chunk => { output += chunk; });
child.stderr.on("data", chunk => { errors += chunk; });
child.stdin.end(sql);
const code = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
if (code !== 0) {
  // libpqの接続エラーにはホスト名などが含まれるため、生ログを返さない。
  const reason = /password authentication failed/i.test(errors) ? "認証に失敗しました。" : /permission denied/i.test(errors) ? "DB権限が不足しています。" : /timeout|timed out/i.test(errors) ? "接続またはSQLがタイムアウトしました。" : "接続またはSQLの実行に失敗しました。";
  throw new Error(reason);
}
if (mode === "inspect" || mode === "diagnose-cache") {
  const jsonLine = output.split(/\r?\n/).find(line => line.trim().startsWith("{"));
  if (!jsonLine) throw new Error("DB構造の応答を取得できませんでした。");
  const result = JSON.parse(jsonLine);
  await writeFile(mode === "inspect" ? "performance-database-schema.json" : "performance-database-cache-context.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(mode === "inspect" ? { inspected: true, functions: result.functions?.map(item => item.name), indexes: result.indexes?.map(item => ({ table: item.table, name: item.name })), tables: result.tables } : { inspected: true, settings: result.settings, roleSettings: result.roleSettings, databaseSettings: result.databaseSettings, columnTypes: result.columnTypes, indexStatus: result.indexStatus, functions: result.functions }));
} else {
  console.log(mode === "apply-error-index" ? "エラー集計用の索引SQLを適用しました。" : mode === "apply-audited-rpcs" ? "監査済みRPCの属性変更と6条件の結果一致確認が完了しました。" : "版確認SQLを適用しました。キャッシュの有効化は速度比較後にPAGE_CACHE_ENABLEDで選択してください。");
}
