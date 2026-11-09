import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config({ quiet: true });
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { db: { schema: "mikage" }, auth: { persistSession: false, autoRefreshToken: false } });
const { data: targets, error: targetError } = await supabase.from("targets").select("key");
if (targetError || !Array.isArray(targets)) throw new Error("監視対象を取得できませんでした。");
const now = new Date();
const { data: groups, error } = await supabase.rpc("get_logs_in_range", { keys: targets.map(target => target.key), start_time: new Date(now.getTime() - 60 * 60_000).toISOString(), end_time: now.toISOString() });
if (error || !Array.isArray(groups)) throw new Error("ログを取得できませんでした。");
const group = groups.find(item => Array.isArray(item.logs) && item.logs.some(row => typeof row.created_at === "string" && Number.isFinite(Date.parse(row.created_at))));
if (!group) throw new Error("境界条件を検証する実測値がありません。");
const timestamp = group.logs.find(row => typeof row.created_at === "string" && Number.isFinite(Date.parse(row.created_at))).created_at;
const time = Date.parse(timestamp);
const ages = groups.flatMap(item => item.logs ?? []).filter(row => typeof row.created_at === "string" && Number.isFinite(Date.parse(row.created_at))).map(row => (now.getTime() - Date.parse(row.created_at)) / 60_000);
console.log(JSON.stringify({ groupFields: Object.keys(group), keyType: typeof group.key, targetMatches: targets.some(item => item.key === group.key), timestampType: typeof timestamp, timestampHasTimezone: /(?:Z|[+-]\d\d:\d\d)$/.test(timestamp), returnedAgeMinutes: { min: Math.min(...ages), max: Math.max(...ages) } }));
for (const [label, start, end] of [["equal-boundaries", timestamp, timestamp], ["at-end", new Date(time - 1000).toISOString(), timestamp], ["at-start", timestamp, new Date(time + 1000).toISOString()]]) {
  const response = await supabase.rpc("get_logs_in_range", { keys: [group.key], start_time: start, end_time: end });
  const rows = Array.isArray(response.data) ? response.data.flatMap(item => item.logs ?? []) : [];
  console.log(JSON.stringify({ label, errorCode: response.error?.code, containsBoundary: rows.some(row => row.created_at === timestamp), sameTimestamp: rows.some(row => Date.parse(row.created_at) === time), rowFields: rows[0] && Object.keys(rows[0]), totalRows: rows.length, offsetsMs: rows.map(row => Date.parse(row.created_at) - time) }));
}
