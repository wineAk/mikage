import { Router } from "express";
import { pool } from "../db.mjs";
import { config } from "../config.mjs";
import { requireBearerAuth } from "../middleware/auth.mjs";

export const watchReservationsRouter = Router();

function parseSlotStart(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?Z$/.test(value)) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const normalized = parsed.toISOString();
  return normalized === value || normalized === value.replace(/Z$/, ".000Z")
    ? normalized
    : null;
}

watchReservationsRouter.post("/v1/watch/reservations", requireBearerAuth, async (request, response) => {
  const { slot_start: slotStartRaw, is_full_run: isFullRun } = request.body ?? {};

  if (typeof isFullRun !== "boolean") {
    response.status(400).json({ error: "is_full_run は boolean である必要があります。" });
    return;
  }

  const slotStart = parseSlotStart(slotStartRaw);
  if (!slotStart) {
    response.status(400).json({ error: "slot_start は有効な ISO 8601 日時である必要があります。" });
    return;
  }

  const { rows: targetRows } = await pool.query(
    `SELECT key FROM mikage.targets WHERE is_enabled = true ORDER BY key ASC`
  );

  if (targetRows.length > config.maxTargetKeys) {
    response.status(413).json({ error: "監視対象数が上限を超えています。" });
    return;
  }

  const targetKeys = targetRows.map((row) => row.key);
  const { rows: reservedRows, rowCount } = await pool.query(
    `SELECT mikage.reserve_watch_run($1::timestamptz, $2::boolean, $3::text[]) AS selected_keys`,
    [slotStart, isFullRun, targetKeys]
  );

  if (rowCount === 0) {
    response.status(503).json({ error: "予約処理に失敗しました。" });
    return;
  }

  const selectedKeys = reservedRows[0]?.selected_keys ?? [];
  if (selectedKeys.length === 0 && targetRows.length === 0) {
    response.status(503).json({ error: "有効な監視対象がありません。" });
    return;
  }

  const [targetNameResult, savedResultsResult] = await Promise.all([
    pool.query("SELECT key, name FROM mikage.targets WHERE key = ANY($1::text[])", [selectedKeys]),
    pool.query("SELECT results FROM mikage.watch_result_batches WHERE slot_start = $1::timestamptz", [slotStart]),
  ]);
  const selectedTargetNames = Object.fromEntries(targetNameResult.rows.map((target) => [target.key, target.name]));
  const savedResults = savedResultsResult.rows[0]?.results ?? null;

  response.json({
    slot_start: slotStart,
    is_full_run: isFullRun,
    selected_target_keys: selectedKeys,
    selected_target_names: selectedTargetNames,
    saved_results: savedResults,
    reserved: selectedKeys.length > 0,
    reason: selectedKeys.length > 0 ? "reserved" : "slot_already_reserved",
  });
});
