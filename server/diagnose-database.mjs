import dotenv from "dotenv";
import { writeFile } from "node:fs/promises";

dotenv.config({ quiet: true });

const baseUrl = process.env.VITE_SUPABASE_URL;
const anonymousKey = process.env.VITE_SUPABASE_ANON_KEY;
if (!baseUrl || !anonymousKey) throw new Error("Supabase設定が不足しています。");
const headers = {
  apikey: anonymousKey,
  Authorization: `Bearer ${anonymousKey}`,
  "Accept-Profile": "mikage",
};
const results = [];

// 顧客行、URL、認証値、実行計画の条件式は出力しない。
async function inspectRequest(label, resource, accept = "application/json") {
  const startedAt = performance.now();
  try {
    const response = await fetch(new URL(`/rest/v1/${resource}`, baseUrl), {
      headers: { ...headers, Accept: accept },
      signal: AbortSignal.timeout(20_000),
    });
    const headerMs = performance.now() - startedAt;
    const body = await response.text();
    let parsed;
    try { parsed = JSON.parse(body); } catch {}
    const contentType = response.headers.get("content-type");
    const isPlan = response.ok && !!contentType?.includes("pgrst.plan");
    const planNodes = [];
    function visitPlan(node) {
      if (!node || typeof node !== "object") return;
      if (node["Node Type"]) planNodes.push({
        nodeType: node["Node Type"],
        totalCost: node["Total Cost"],
        planRows: node["Plan Rows"],
        actualTotalTime: node["Actual Total Time"],
        actualRows: node["Actual Rows"],
      });
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visitPlan);
        else if (value && typeof value === "object") visitPlan(value);
      }
    }
    if (isPlan) visitPlan(parsed);
    const result = {
      label, status: response.status, headerMs, totalMs: performance.now() - startedAt,
      contentType, serverTiming: response.headers.get("server-timing"),
      errorCode: parsed?.code, bytes: Buffer.byteLength(body),
      rowCount: Array.isArray(parsed) && !isPlan ? parsed.length : undefined,
      planAvailable: isPlan, planNodes: isPlan ? planNodes : undefined,
    };
    results.push(result);
    console.log(JSON.stringify(result));
  } catch (error) {
    const result = { label, errorName: error.name, errorCode: error.cause?.code };
    results.push(result);
    console.log(JSON.stringify(result));
  }
}

await inspectRequest("targets-explain", "targets?select=key&limit=0", "application/vnd.pgrst.plan+json");
await inspectRequest("catalog-exposure", "pg_indexes?select=indexname&limit=0");
for (let iteration = 0; iteration < 5; iteration++) {
  await inspectRequest("zero-row-targets", "targets?select=key&limit=0");
  await inspectRequest("zero-row-logs", "logs?select=created_at&limit=0");
  await inspectRequest("zero-row-incidents", "incidents?select=created_at&limit=0");
  await inspectRequest("current-errors-rpc", "rpc/get_error_logs?start_offset=0&end_offset=-1");
}
await writeFile("performance-database-diagnostic.json", JSON.stringify({ measuredAt: new Date().toISOString(), results }, null, 2));
