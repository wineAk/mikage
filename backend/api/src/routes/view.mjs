import { Router } from "express";
import { pool } from "../db.mjs";
import { requireBearerAuth } from "../middleware/auth.mjs";
import { isValidTargetHeaders } from "../target-headers.mjs";
import { PREVIEW_ALLOWED_HOSTS } from "../preview-target-hosts.mjs";

const previewAllowedHosts = new Set(PREVIEW_ALLOWED_HOSTS);

export const viewRouter = Router();

viewRouter.get("/v1/view/targets", requireBearerAuth, async (_request, response) => {
  const { rows } = await pool.query("SELECT key, name FROM mikage.targets ORDER BY key");
  response.json({ targets: rows });
});

viewRouter.get("/v1/view/target-proxy", requireBearerAuth, async (request, response) => {
  const key = request.query.key;
  if (typeof key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(key)) {
    response.status(400).json({ error: "keyが不正です。" });
    return;
  }
  const { rows } = await pool.query("SELECT name, url, headers FROM mikage.targets WHERE key=$1", [key]);
  response.set("Cache-Control", "private, no-store");
  const target = rows[0];
  response.json({ target: target && isAllowedPreviewTarget(target.url) && isValidTargetHeaders(target.headers) ? target : null });
});

function isAllowedPreviewTarget(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === "https:" && !parsedUrl.username && !parsedUrl.password && !parsedUrl.hash && previewAllowedHosts.has(parsedUrl.hostname.toLowerCase().replace(/\.$/, ""));
  } catch {
    return false;
  }
}

viewRouter.get("/v1/view/logs", requireBearerAuth, async (request, response) => {
  const keys = (request.query.keys ?? "").split(",").filter(Boolean);
  const start = request.query.start;
  const end = request.query.end;
  if (keys.length > 500 || keys.some((key) => key.length > 200) || !start || !end || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end)) || Date.parse(start) > Date.parse(end)) {
    response.status(400).json({ error: "keysまたは期間が不正です。" });
    return;
  }
  if (keys.length === 0) {
    response.json({ data: [] });
    return;
  }

  const { rows } = await pool.query(
    `WITH bounds AS (
       SELECT $1::text[] AS keys, $2::timestamptz AS start_time, $3::timestamptz AS end_time,
         EXTRACT(EPOCH FROM ($3::timestamptz - $2::timestamptz)) / 60 AS diff_minutes
     ),
     interval_value AS (
       SELECT *, CASE
         WHEN diff_minutes <= 60 THEN 1
         WHEN diff_minutes <= 180 THEN 3
         WHEN diff_minutes <= 360 THEN 6
         WHEN diff_minutes <= 720 THEN 12
         WHEN diff_minutes <= 1440 THEN 24
         WHEN diff_minutes <= 4320 THEN 72
         WHEN diff_minutes <= 10080 THEN 168
         WHEN diff_minutes <= 40320 THEN 672
         ELSE 1440
       END AS interval_minutes
       FROM bounds
     ),
     filtered_logs AS (
       SELECT logs.*
       FROM mikage.logs AS logs CROSS JOIN interval_value AS bounds
       WHERE logs.target_key = ANY(bounds.keys)
         AND logs.created_at >= bounds.start_time
         AND logs.created_at <= bounds.end_time
     ),
     bucketed_logs AS (
       SELECT target_key,
         TIMESTAMPTZ 'epoch' + INTERVAL '1 minute' * FLOOR(EXTRACT(EPOCH FROM created_at) / 60 / interval_minutes) * interval_minutes AS bucket_time,
         response_time, status_code, status_message, error_name, error_code
       FROM filtered_logs CROSS JOIN interval_value
     ),
     aggregated_logs AS (
       SELECT target_key, bucket_time, AVG(response_time)::integer AS response_time,
         MAX(status_code) AS status_code, MAX(status_message) AS status_message,
         MAX(error_name) AS error_name, MAX(error_code) AS error_code
       FROM bucketed_logs
       GROUP BY target_key, bucket_time
     )
     SELECT targets.key, targets.name,
       JSONB_AGG(JSONB_BUILD_OBJECT(
         'created_at', aggregated.bucket_time, 'response_time', aggregated.response_time,
         'status_code', aggregated.status_code, 'status_message', aggregated.status_message,
         'error_name', aggregated.error_name, 'error_code', aggregated.error_code
       ) ORDER BY aggregated.bucket_time) AS logs
     FROM mikage.targets AS targets
     CROSS JOIN interval_value AS bounds
     LEFT JOIN aggregated_logs AS aggregated ON aggregated.target_key = targets.key
     WHERE targets.key = ANY(bounds.keys)
     GROUP BY targets.key, targets.name
     ORDER BY targets.key`,
    [keys, start, end]
  );
  response.json({ data: rows });
});

viewRouter.get("/v1/view/errors", requireBearerAuth, async (request, response) => {
  const offset = Number(request.query.offset ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 120) {
    response.status(400).json({ error: "offsetが不正です。" });
    return;
  }
  const { rows } = await pool.query(
    `WITH month_range AS (
       SELECT (DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo') - MAKE_INTERVAL(months => $1::integer)) AT TIME ZONE 'Asia/Tokyo' AS start_time
     ),
     range_values AS (
       SELECT start_time - INTERVAL '1 month' AS previous_start, start_time,
         start_time + INTERVAL '1 month' AS end_time,
         start_time + INTERVAL '2 months' AS next_end
       FROM month_range
     ),
     current_errors AS (
       SELECT logs.target_key, targets.name, logs.created_at, logs.response_time, logs.status_code,
         logs.status_message, logs.error_name, logs.error_code
       FROM mikage.logs AS logs
       JOIN mikage.targets AS targets ON targets.key = logs.target_key
       CROSS JOIN range_values AS ranges
       WHERE logs.created_at >= ranges.start_time AND logs.created_at < ranges.end_time
         AND (logs.status_code IS DISTINCT FROM 200 OR logs.status_code IS NULL OR logs.error_code IS NOT NULL)
         AND logs.error_code IS DISTINCT FROM 'NO_INTERNET'
     ),
     previous_count AS (
       SELECT COUNT(*) AS count FROM mikage.logs AS logs CROSS JOIN range_values AS ranges
       WHERE logs.created_at >= ranges.previous_start AND logs.created_at < ranges.start_time
         AND (logs.status_code IS DISTINCT FROM 200 OR logs.status_code IS NULL OR logs.error_code IS NOT NULL)
         AND logs.error_code IS DISTINCT FROM 'NO_INTERNET'
     ),
     next_count AS (
       SELECT COUNT(*) AS count FROM mikage.logs AS logs CROSS JOIN range_values AS ranges
       WHERE logs.created_at >= ranges.end_time AND logs.created_at < ranges.next_end
         AND (logs.status_code IS DISTINCT FROM 200 OR logs.status_code IS NULL OR logs.error_code IS NOT NULL)
         AND logs.error_code IS DISTINCT FROM 'NO_INTERNET'
     )
     SELECT JSONB_BUILD_OBJECT(
       'previous_month_count', previous_count.count,
       'next_month_count', next_count.count,
       'logs', COALESCE((
         SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
           'target_key', target_key, 'name', name, 'created_at', created_at,
           'response_time', response_time, 'status_code', status_code,
           'status_message', status_message, 'error_name', error_name, 'error_code', error_code
         ) ORDER BY created_at DESC, name ASC)
         FROM current_errors
       ), '[]'::jsonb)
     ) AS data
     FROM previous_count CROSS JOIN next_count`,
    [offset]
  );
  response.json({ data: rows[0].data });
});

viewRouter.get("/v1/view/incidents", requireBearerAuth, async (request, response) => {
  const offset = Number(request.query.offset ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 120) {
    response.status(400).json({ error: "offsetが不正です。" });
    return;
  }
  const { rows } = await pool.query(
    `SELECT keyword, created_at, updated_at, count, is_closed, googlechat_name, instatus_id
     FROM mikage.incidents
     WHERE created_at >= ((DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo') - MAKE_INTERVAL(months => $1::integer)) AT TIME ZONE 'Asia/Tokyo')
       AND created_at < ((DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo') - MAKE_INTERVAL(months => $1::integer) + INTERVAL '1 month') AT TIME ZONE 'Asia/Tokyo')
     ORDER BY created_at ASC`,
    [offset]
  );
  response.json({ data: rows.map((row) => ({ ...row, count: Number(row.count) })) });
});

viewRouter.get("/v1/view/revision", requireBearerAuth, async (_request, response) => {
  const { rows } = await pool.query(
    "SELECT EXTRACT(EPOCH FROM pg_postmaster_start_time())::text || ':' || epoch::text || ':' || revision::text AS revision FROM mikage.page_cache_revision WHERE singleton = true"
  );
  response.json({ revision: rows[0]?.revision ?? null });
});
