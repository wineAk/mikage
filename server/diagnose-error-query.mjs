import dotenv from "dotenv";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

dotenv.config({ quiet: true });
const databaseUrl = new URL(process.env.DATABASE_URL);
const environment = {
  ...process.env,
  PGHOST: databaseUrl.hostname,
  PGPORT: databaseUrl.port || "5432",
  PGUSER: decodeURIComponent(databaseUrl.username),
  PGPASSWORD: decodeURIComponent(databaseUrl.password),
  PGDATABASE: decodeURIComponent(databaseUrl.pathname.slice(1)) || "postgres",
  PGCONNECT_TIMEOUT: "10",
};
if (databaseUrl.searchParams.has("sslmode")) environment.PGSSLMODE = databaseUrl.searchParams.get("sslmode");
const schema = JSON.parse(await readFile("performance-database-schema.json", "utf8"));
const definition = schema.functions.find(item => item.name === "get_error_logs")?.definition;
const body = definition?.match(/AS \$function\$([\s\S]*)\$function\$/)?.[1];
if (!body) throw new Error("既存エラーログRPCの定義を読み込めませんでした。");
const query = body.replace(/\bstart_offset\b/g, "0").replace(/\bend_offset\b/g, "(-1)");
const child = spawn("psql", ["-X", "-w", "-tA", "-v", "ON_ERROR_STOP=1"], {
  env: environment,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
  timeout: 45_000,
});
let output = "";
let errors = "";
child.stdout.on("data", chunk => { output += chunk; });
child.stderr.on("data", chunk => { errors += chunk; });
child.stdin.end(`BEGIN READ ONLY; SET LOCAL ROLE anon; SET LOCAL statement_timeout='30s'; EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}; ROLLBACK;`);
const code = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
if (code !== 0) {
  throw new Error(/statement timeout/.test(errors) ? "エラーログの実行計画取得がタイムアウトしました。" : "エラーログの実行計画取得に失敗しました。");
}
const plan = JSON.parse(output.slice(output.indexOf("["), output.lastIndexOf("]") + 1))[0];

function summarizePlan(node) {
  return {
    type: node["Node Type"],
    relation: node["Relation Name"],
    index: node["Index Name"],
    estimatedRows: node["Plan Rows"],
    actualRows: node["Actual Rows"],
    loops: node["Actual Loops"],
    rowsRemoved: node["Rows Removed by Filter"],
    sharedHitBlocks: node["Shared Hit Blocks"],
    sharedReadBlocks: node["Shared Read Blocks"],
    children: node.Plans?.map(summarizePlan),
  };
}

const results = {
  measuredAt: new Date().toISOString(),
  executionMs: plan["Execution Time"],
  planningMs: plan["Planning Time"],
  jit: plan.JIT,
  plan: summarizePlan(plan.Plan),
  readOnly: true,
};
const label = process.argv[2] ?? "before";
if (!/^[a-z0-9-]+$/.test(label)) throw new Error("結果ラベルには英小文字・数字・ハイフンだけを使用してください。");
await writeFile(`performance-error-plan-${label}.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
