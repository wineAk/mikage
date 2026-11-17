import { createHash } from "node:crypto";
import { Router } from "express";
import { withClient } from "../db.mjs";
import { config } from "../config.mjs";
import { requireBearerAuth } from "../middleware/auth.mjs";

export const watchResultsRouter = Router();

const logFields = ["response_time", "status_code", "status_message", "error_name", "error_code"];
const resultFields = ["target_key", "created_at", ...logFields];

function hasOnlyKeys(value, allowed) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function isIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validateBatch(body) {
  if (!hasOnlyKeys(body, ["slot_start", "results"]) || typeof body.slot_start !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:00(?:\.000)?Z$/.test(body.slot_start)) return { error: "slot_start が不正です。" };
  const slotStart = new Date(body.slot_start);
  if (Number.isNaN(slotStart.getTime()) || slotStart.toISOString() !== body.slot_start && slotStart.toISOString() !== body.slot_start.replace(/Z$/, ".000Z")) return { error: "slot_start が不正です。" };
  const normalizedSlotStart = slotStart.toISOString();
  if (!Array.isArray(body.results) || body.results.length === 0 || body.results.length > config.maxTargetKeys) return { error: "results の件数が不正です。" };
  const keys = body.results.map((result) => result?.target_key);
  if (keys.some((key) => typeof key !== "string" || key.length === 0 || key.length > 200) || new Set(keys).size !== keys.length) return { error: "target_key が不正または重複しています。" };
  if (body.results.some((result) => !hasOnlyKeys(result, resultFields) || !resultFields.slice(0, 2).every((field) => Object.hasOwn(result, field)) || !isIsoDate(result.created_at) || logFields.some((field) => {
    const value = result[field];
    if (value === null || value === undefined) return false;
    if (field === "response_time") return typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 2147483647;
    if (field === "status_code") return !Number.isInteger(value) || (value < 100 || value > 599) && value !== 520;
    return typeof value !== "string" || value.length > 2000;
  }))) return { error: "results の値が不正です。" };
  return {
    error: null,
    data: {
      slot_start: normalizedSlotStart,
      results: body.results
        .map((result) => ({
          target_key: result.target_key,
          created_at: result.created_at,
          ...Object.fromEntries(logFields.map((field) => [field, result[field] ?? null])),
        }))
        .sort((left, right) => left.target_key.localeCompare(right.target_key)),
    },
  };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

watchResultsRouter.post("/v1/watch/results", requireBearerAuth, async (request, response) => {
  const validation = validateBatch(request.body);
  if (validation.error) {
    response.status(400).json({ error: validation.error });
    return;
  }

  const body = validation.data;
  const requestHash = createHash("sha256").update(JSON.stringify(canonical(body))).digest("hex");
  const outcome = await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const inserted = await client.query(
        "INSERT INTO mikage.watch_result_batches (slot_start, request_hash, results) VALUES ($1::timestamptz, $2, $3::jsonb) ON CONFLICT (slot_start) DO NOTHING RETURNING slot_start",
        [body.slot_start, requestHash, JSON.stringify(body.results)]
      );
      if (inserted.rowCount === 0) {
        const existing = await client.query("SELECT request_hash FROM mikage.watch_result_batches WHERE slot_start = $1::timestamptz", [body.slot_start]);
        await client.query("ROLLBACK");
        return { status: existing.rows[0]?.request_hash === requestHash ? "duplicate" : "conflict" };
      }

      const reservation = await client.query(
        "SELECT target_key, first_failed_at, failure_confirmed_at FROM mikage.watch_target_states WHERE last_reserved_at = $1::timestamptz ORDER BY target_key FOR UPDATE",
        [body.slot_start]
      );
      const submittedKeys = body.results.map((result) => result.target_key).sort();
      const reservedKeys = reservation.rows.map((row) => row.target_key);
      if (reservedKeys.length !== submittedKeys.length || reservedKeys.some((key, index) => key !== submittedKeys[index])) {
        await client.query("ROLLBACK");
        return { status: "unreserved" };
      }

      for (const result of body.results) {
        await client.query(
          "INSERT INTO mikage.logs (target_key, created_at, response_time, status_code, status_message, error_name, error_code) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [result.target_key, result.created_at, result.response_time === null || result.response_time === undefined ? null : Math.round(result.response_time), result.status_code ?? null, result.status_message ?? null, result.error_name ?? null, result.error_code ?? null]
        );
      }

      const previousStateByKey = new Map(reservation.rows.map((state) => [state.target_key, state]));
      for (const result of body.results) {
        const previousState = previousStateByKey.get(result.target_key);
        const hasFailed = result.status_code !== 200 && result.error_code !== "NO_INTERNET"
          || result.error_code !== null && result.error_code !== "NO_INTERNET";
        const firstFailedAt = hasFailed ? previousState.first_failed_at ?? result.created_at : null;
        const failureConfirmedAt = hasFailed
          ? previousState.failure_confirmed_at ?? (Date.parse(result.created_at) - Date.parse(firstFailedAt) >= 5 * 60 * 1000 ? result.created_at : null)
          : null;
        const update = await client.query(
          "UPDATE mikage.watch_target_states SET last_checked_at=$2, first_failed_at=$3, failure_confirmed_at=$4, response_time=$5, status_code=$6, status_message=$7, error_name=$8, error_code=$9 WHERE target_key=$1 AND last_reserved_at=$10::timestamptz",
          [result.target_key, result.created_at, firstFailedAt, failureConfirmedAt, result.response_time, result.status_code, result.status_message, result.error_name, result.error_code, body.slot_start]
        );
        if (update.rowCount !== 1) throw new Error("watch state reservation changed during result save");
      }

      await client.query("COMMIT");
      return { status: "saved" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });

  if (outcome.status === "unreserved") {
    response.status(409).json({ error: "このslotに対象が予約されていません。" });
    return;
  }
  if (outcome.status === "conflict") {
    response.status(409).json({ error: "同じslotに異なる結果が保存済みです。" });
    return;
  }
  response.status(outcome.status === "duplicate" ? 200 : 201).json({ saved: true, duplicate: outcome.status === "duplicate", slot_start: body.slot_start });
});
