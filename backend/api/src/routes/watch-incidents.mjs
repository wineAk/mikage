import { createHash } from "node:crypto";
import { Router } from "express";
import { pool, withClient } from "../db.mjs";
import { requireBearerAuth } from "../middleware/auth.mjs";
import { isValidWatchIncidentRequestId } from "../watch-incident-request-id.mjs";

export const watchIncidentsRouter = Router();

const labels = new Set(["saaske", "saaske_api", "saaske_webform", "saaske_webtracking", "saaske_other", "works", "web"]);
const operations = new Set(["open", "notification_pending", "update", "close"]);
const fields = ["request_id", "operation", "keyword", "incident_id", "now", "count", "instatus_id", "googlechat_name"];

function isValidIncidentId(value) {
  return typeof value === "string" && /^[1-9]\d{0,18}$/.test(value)
    || Number.isSafeInteger(value) && value > 0;
}

function validate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((field) => !fields.includes(field))) return "bodyが不正です。";
  if (!isValidWatchIncidentRequestId(body.request_id)) return "request_idが不正です。";
  if (!operations.has(body.operation) || !labels.has(body.keyword)) return "operationまたはkeywordが不正です。";
  if (typeof body.now !== "string" || Number.isNaN(Date.parse(body.now)) || new Date(body.now).toISOString() !== body.now) return "nowが不正です。";
  if (body.operation === "open" && (body.incident_id !== null || body.count !== 1)) return "openの引数が不正です。";
  if (body.operation === "notification_pending" && !isValidIncidentId(body.incident_id)) return "notification_pendingの引数が不正です。";
  if (body.operation !== "open" && !isValidIncidentId(body.incident_id)) return "incident_idが不正です。";
  if (body.operation === "update" && (!Number.isSafeInteger(body.count) || body.count < 1)) return "countが不正です。";
  for (const field of ["instatus_id", "googlechat_name"]) {
    if (body[field] !== undefined && body[field] !== null && (typeof body[field] !== "string" || body[field].length > 500)) return `${field}が不正です。`;
  }
  return null;
}

watchIncidentsRouter.post("/v1/watch/incidents", requireBearerAuth, async (request, response) => {
  const error = validate(request.body);
  if (error) {
    response.status(400).json({ error });
    return;
  }
  const body = {
    request_id: request.body.request_id,
    operation: request.body.operation,
    keyword: request.body.keyword,
    incident_id: request.body.incident_id ?? null,
    now: request.body.now,
    count: request.body.count ?? null,
    instatus_id: request.body.instatus_id ?? null,
    googlechat_name: request.body.googlechat_name ?? null,
  };
  const requestHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const result = await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const inserted = await client.query(
        "INSERT INTO mikage.incident_transition_batches (request_id, request_hash, incident_id, transition) VALUES ($1,$2,$3,$4) ON CONFLICT (request_id) DO NOTHING RETURNING request_id",
        [body.request_id, requestHash, body.incident_id, body.operation]
      );
      if (inserted.rowCount === 0) {
        const previous = await client.query("SELECT request_hash, incident_id FROM mikage.incident_transition_batches WHERE request_id=$1", [body.request_id]);
        await client.query("ROLLBACK");
        return previous.rows[0]?.request_hash === requestHash ? { status: "duplicate", incident_id: previous.rows[0].incident_id } : { status: "conflict" };
      }

      let incident;
      if (body.operation === "open") {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`mikage:incident:${body.keyword}`]);
        const active = await client.query("SELECT id FROM mikage.incidents WHERE keyword=$1 AND is_closed IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [body.keyword]);
        if (active.rowCount > 0) {
          await client.query("ROLLBACK");
          return { status: "active_exists", incident_id: active.rows[0].id };
        }
        const created = await client.query(
          "INSERT INTO mikage.incidents (keyword, count, created_at, updated_at, notification_pending) VALUES ($1,1,$2,$2,true) RETURNING id",
          [body.keyword, body.now]
        );
        incident = created.rows[0];
      } else if (body.operation === "notification_pending") {
        const pending = await client.query(
          "UPDATE mikage.incidents SET notification_pending=true WHERE id=$1 AND keyword=$2 AND is_closed IS NULL RETURNING id",
          [body.incident_id, body.keyword]
        );
        if (pending.rowCount === 0) {
          await client.query("ROLLBACK");
          return { status: "not_found" };
        }
        incident = pending.rows[0];
      } else {
        const exists = await client.query("SELECT id FROM mikage.incidents WHERE id=$1 AND keyword=$2 AND is_closed IS NULL FOR UPDATE", [body.incident_id, body.keyword]);
        if (exists.rowCount === 0) {
          await client.query("ROLLBACK");
          return { status: "not_found" };
        }
        const updated = body.operation === "close"
          ? await client.query("UPDATE mikage.incidents SET is_closed=true, updated_at=$2, notification_pending=false WHERE id=$1 RETURNING id", [body.incident_id, body.now])
          : await client.query("UPDATE mikage.incidents SET count=$2, updated_at=$3, instatus_id=$4, googlechat_name=$5, notification_pending=false WHERE id=$1 RETURNING id", [body.incident_id, body.count, body.now, body.instatus_id, body.googlechat_name]);
        incident = updated.rows[0];
      }
      await client.query("UPDATE mikage.incident_transition_batches SET incident_id=$2 WHERE request_id=$1", [body.request_id, incident.id]);
      await client.query("COMMIT");
      return { status: "saved", incident_id: incident.id };
    } catch (cause) {
      await client.query("ROLLBACK");
      throw cause;
    }
  });
  if (result.status === "conflict") return response.status(409).json({ error: "request_idが異なる内容で使用済みです。" });
  if (result.status === "active_exists") return response.status(409).json({ error: "未解決incidentがすでにあります。", incident_id: result.incident_id });
  if (result.status === "not_found") return response.status(404).json({ error: "未解決incidentが見つかりません。" });
  return response.status(result.status === "duplicate" ? 200 : 201).json({ saved: true, duplicate: result.status === "duplicate", incident_id: result.incident_id ?? null });
});

watchIncidentsRouter.get("/v1/watch/state", requireBearerAuth, async (_request, response) => {
  const [states, incidents] = await Promise.all([
    pool.query("SELECT * FROM mikage.watch_target_states ORDER BY target_key"),
    pool.query("SELECT * FROM mikage.incidents WHERE is_closed IS NULL ORDER BY created_at"),
  ]);
  response.json({
    states: states.rows,
    active_incidents: incidents.rows.map((incident) => ({ ...incident, count: Number(incident.count) })),
  });
});
