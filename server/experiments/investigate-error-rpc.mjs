import dotenv from "dotenv";
dotenv.config({ quiet: true });
const baseUrl = process.env.VITE_SUPABASE_URL;
const anonymousKey = process.env.VITE_SUPABASE_ANON_KEY;
const headers = { apikey: anonymousKey, Authorization: `Bearer ${anonymousKey}`, "Accept-Profile": "mikage" };

async function getResource(resource, extraHeaders = {}) {
  const startedAt = performance.now();
  const response = await fetch(new URL(`/rest/v1/${resource}`, baseUrl), { headers: { ...headers, ...extraHeaders }, signal: AbortSignal.timeout(15_000) });
  const result = await response.json();
  return { status: response.status, ms: performance.now() - startedAt, result, count: response.headers.get("content-range") };
}

// スキーマと件数・述語の一致結果のみを出力し、実レコードは出力しない。
const schema = await getResource("", { Accept: "application/openapi+json" });
console.log(JSON.stringify({ label: "api-catalog", status: schema.status, paths: Object.keys(schema.result.paths ?? {}), functions: Object.fromEntries(Object.entries(schema.result.paths ?? {}).filter(([name]) => name.startsWith("/rpc/get_error_logs")).map(([name, info]) => [name, Object.values(info).flatMap(method => (method.parameters ?? []).map(parameter => ({ name: parameter.name, type: parameter.type, schema: parameter.schema }))) ])) }));
const selected = "target_key,created_at,response_time,status_code,status_message,error_code,error_name";
for (const offset of [0, 1, 2, 3]) {
  const rpc = await getResource(`rpc/get_error_logs?start_offset=${offset}&end_offset=${offset - 1}`);
  const result = rpc.result;
  const rows = result?.logs;
  const summary = { label: "rpc-summary", offset, status: rpc.status, ms: rpc.ms, code: result?.code, shape: result && typeof result === "object" ? Object.keys(result) : typeof result, count: rows?.length, previousMonthCount: result?.previous_month_count, nextMonthCount: result?.next_month_count };
  if (!Array.isArray(rows)) { console.log(JSON.stringify(summary)); continue; }
  summary.predicates = {
    statusNull: rows.filter(row => row.status_code === null).length,
    statusSuccess: rows.filter(row => row.status_code >= 200 && row.status_code < 300).length,
    statusNon200: rows.filter(row => row.status_code !== null && row.status_code !== 200).length,
    hasErrorCode: rows.filter(row => row.error_code !== null).length,
    hasErrorName: rows.filter(row => row.error_name !== null).length,
    nullResponseTime: rows.filter(row => row.response_time === null).length,
  };
  summary.statusCounts = Object.fromEntries([...new Set(rows.map(row => row.status_code))].map(status => [String(status), rows.filter(row => row.status_code === status).length]));
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1) - 9 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset + 1, 1) - 9 * 60 * 60 * 1000);
  const direct = await getResource(`logs?select=${selected},targets(name)&created_at=gte.${start.toISOString()}&created_at=lt.${end.toISOString()}&or=(status_code.neq.200,error_code.not.is.null,status_code.is.null)&order=created_at.desc&limit=10000`);
  const directRows = Array.isArray(direct.result) ? direct.result.map(row => ({ ...row, name: row.targets?.name })) : direct.result;
  const compareColumns = [...selected.split(","), "name"];
  const serializeRow = row => JSON.stringify(compareColumns.map(column => row[column]));
  if (Array.isArray(directRows)) {
    const rpcRows = new Set(rows.map(serializeRow));
    const directKeys = new Set(directRows.map(serializeRow));
    summary.direct = { status: direct.status, ms: direct.ms, count: directRows.length, contentRange: direct.count, missingFromDirect: [...rpcRows].filter(row => !directKeys.has(row)).length, extraInDirect: [...directKeys].filter(row => !rpcRows.has(row)).length, descendingOrderMatches: rows.every((row, index) => serializeRow(row) === serializeRow(directRows[index] ?? {})) };
  } else summary.direct = { status: direct.status, ms: direct.ms, code: directRows?.code };
  summary.rpcOrder = {
    ascending: rows.every((row, index) => index === 0 || Date.parse(rows[index - 1].created_at) <= Date.parse(row.created_at)),
    descending: rows.every((row, index) => index === 0 || Date.parse(rows[index - 1].created_at) >= Date.parse(row.created_at)),
  };
  const previousStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset - 1, 1) - 9 * 60 * 60 * 1000);
  const nextEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset + 2, 1) - 9 * 60 * 60 * 1000);
  for (const [label, lower, upper] of [["previous", previousStart, start], ["next", end, nextEnd]]) {
    const exists = await getResource(`logs?select=created_at&created_at=gte.${lower.toISOString()}&created_at=lt.${upper.toISOString()}&or=(status_code.neq.200,error_code.not.is.null,status_code.is.null)&limit=1`);
    summary[`${label}Exists`] = { status: exists.status, ms: exists.ms, hasRows: Array.isArray(exists.result) && exists.result.length > 0 };
  }
  console.log(JSON.stringify(summary));
}
const alternate = await getResource("rpc/get_error_logs_?start_offset=0&end_offset=-1");
console.log(JSON.stringify({ label: "alternate-error-rpc", status: alternate.status, ms: alternate.ms, count: Array.isArray(alternate.result) ? alternate.result.length : undefined, columns: Array.isArray(alternate.result) && alternate.result[0] ? Object.keys(alternate.result[0]) : undefined, code: alternate.result?.code }));
