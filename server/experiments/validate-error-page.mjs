import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { writeFile } from "node:fs/promises";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(["./errorPageFilter", "../app/lib/monthRange"].includes(specifier) ? `${specifier}.ts` : specifier, context);
} });
const { readErrorPage } = await import("./errorPageQuery.ts");
dotenv.config({ quiet: true });
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
  db: { schema: "mikage" }, auth: { persistSession: false, autoRefreshToken: false },
});
const columns = ["name", "target_key", "created_at", "response_time", "status_code", "status_message", "error_code", "error_name"];
function canonicalLogs(logs) {
  return (logs ?? []).map(row => JSON.stringify(columns.map(column => row[column]))).sort();
}
const results = [];
for (const offset of [0, 1, 2, 3]) {
  const oldStart = performance.now();
  const old = await supabase.rpc("get_error_logs", { start_offset: offset, end_offset: offset - 1 });
  const oldMs = performance.now() - oldStart;
  assert.ok(!old.error, "既存RPCの取得に失敗しました。");
  const freshStart = performance.now();
  const fresh = await readErrorPage(supabase, offset);
  const directMs = performance.now() - freshStart;
  assert.ok(JSON.stringify(canonicalLogs(fresh.logs)) === JSON.stringify(canonicalLogs(old.data.logs)), `offset${offset}のログが一致しません。`);
  assert.equal(fresh.previous_month_count, old.data.previous_month_count);
  assert.equal(fresh.next_month_count, old.data.next_month_count);
  const result = { offset, oldMs, directMs, count: fresh.logs.length, previousMonthCount: fresh.previous_month_count, nextMonthCount: fresh.next_month_count, exactMultisetMatch: true };
  results.push(result);
  console.log(JSON.stringify(result));
}
// 接続確立後の同条件を交互に計測し、ネットワーク変動を含めて比較する。
for (let iteration = 0; iteration < 5; iteration++) {
  const oldStart = performance.now();
  const old = await supabase.rpc("get_error_logs", { start_offset: 0, end_offset: -1 });
  const oldMs = performance.now() - oldStart;
  const directStart = performance.now();
  const fresh = await readErrorPage(supabase, 0);
  const directMs = performance.now() - directStart;
  assert.ok(!old.error, "既存RPCの取得に失敗しました。");
  assert.ok(JSON.stringify(canonicalLogs(fresh.logs)) === JSON.stringify(canonicalLogs(old.data.logs)), "ログが一致しません。");
  const result = { iteration, offset: 0, oldMs, directMs, exactMultisetMatch: true };
  results.push(result);
  console.log(JSON.stringify(result));
}
await writeFile("performance-error-query-parity.json", JSON.stringify({ measuredAt: new Date().toISOString(), results }, null, 2));
