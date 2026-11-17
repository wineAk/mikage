import { Router } from "express";
import { pool } from "../db.mjs";
import { requireBearerAuth } from "../middleware/auth.mjs";
import { config } from "../config.mjs";
import { validateTargetUrl } from "../target-url.mjs";
import { isValidTargetHeaders } from "../target-headers.mjs";

export const monitoringTargetsRouter = Router();

monitoringTargetsRouter.get("/v1/monitoring/targets", requireBearerAuth, async (_request, response) => {
  const { rows } = await pool.query(
    `SELECT key, name, url, headers
     FROM mikage.targets
     WHERE is_enabled = true
     ORDER BY key ASC`
  );
  if (rows.some((target) => !validateTargetUrl(target.url, config.allowedTargetHosts) || !isValidTargetHeaders(target.headers))) {
    response.status(503).json({ error: "監視対象のURL設定を確認してください。" });
    return;
  }
  response.json({ targets: rows });
});
