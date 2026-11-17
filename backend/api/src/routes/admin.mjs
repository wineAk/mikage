import { Router } from "express";
import { fileURLToPath } from "node:url";
import { pool, withClient } from "../db.mjs";
import { config } from "../config.mjs";
import { isAllowedAdminHost } from "../admin-host.mjs";
import { validateTargetUrl } from "../target-url.mjs";
import { isValidTargetHeaders } from "../target-headers.mjs";

export const adminRouter = Router();

const targetFields = ["name", "url", "headers"];

const requireAllowedAdminHost = (request, response, next) => {
  if (!isAllowedAdminHost(request.get("host"), config.allowedAdminHosts)) {
    response.status(404).json({ error: "見つかりません。" });
    return;
  }
  next();
};

function rejectCrossOrigin(request, response) {
  const origin = request.get("origin");
  if (!origin) return false;
  try {
    if (new URL(origin).host === request.get("host")) return false;
  } catch {}
  response.status(403).json({ error: "同じoriginからのみ変更できます。" });
  return true;
}

function validateTarget(body, { create = false } = {}) {
  const allowedFields = create ? ["key", ...targetFields] : targetFields;
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !allowedFields.includes(key))) return "入力fieldが不正です。";
  if (create && (typeof body.key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(body.key))) return "keyは英数字で始まる英数字・ハイフン・アンダースコアにしてください。";
  if (typeof body.name !== "string" || body.name.trim().length === 0 || body.name.length > 200) return "nameは1〜200文字で入力してください。";
  if (typeof body.url !== "string" || body.url.length > 2048) return "urlが不正です。";
  if (!validateTargetUrl(body.url, config.allowedTargetHosts)) return "urlは認証情報・fragmentのないHTTPS URLで、MIKAGE_TARGET_ALLOWED_HOSTSに含まれる必要があります。";
  if (!isValidTargetHeaders(body.headers)) return "headersは有効なobjectまたはnullにしてください。";
  return null;
}

adminRouter.get("/admin", requireAllowedAdminHost, (_request, response) => {
  response.set("Cache-Control", "private, no-store");
  response.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  response.sendFile(fileURLToPath(new URL("../../admin/index.html", import.meta.url)));
});

adminRouter.get("/admin.js", requireAllowedAdminHost, (_request, response) => {
  response.set("Cache-Control", "private, no-store");
  response.type("application/javascript");
  response.sendFile(fileURLToPath(new URL("../../admin/admin.js", import.meta.url)));
});

adminRouter.get("/v1/admin/targets", requireAllowedAdminHost, async (_request, response) => {
  response.set("Cache-Control", "private, no-store");
  const { rows } = await pool.query("SELECT key, name, url, headers, is_enabled FROM mikage.targets ORDER BY key");
  response.json({ targets: rows });
});

adminRouter.post("/v1/admin/targets", requireAllowedAdminHost, async (request, response) => {
  if (rejectCrossOrigin(request, response)) return;
  const validationError = validateTarget(request.body, { create: true });
  if (validationError) {
    response.status(400).json({ error: validationError });
    return;
  }
  const target = request.body;
  try {
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(
          "INSERT INTO mikage.targets (key, name, url, headers, is_enabled) VALUES ($1,$2,$3,$4::jsonb,true)",
          [target.key, target.name.trim(), target.url, target.headers === null ? null : JSON.stringify(target.headers)]
        );
        await client.query(
          "INSERT INTO mikage.target_change_audit (target_key, operation, changed_fields) VALUES ($1,'create',$2::text[])",
          [target.key, ["key", "name", "url", "headers", "is_enabled"]]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  } catch (error) {
    if (error?.code === "23505") {
      response.status(409).json({ error: "同じkeyのtargetがすでにあります。" });
      return;
    }
    throw error;
  }
  response.status(201).json({ saved: true, key: target.key });
});

adminRouter.put("/v1/admin/targets/:key", requireAllowedAdminHost, async (request, response) => {
  if (rejectCrossOrigin(request, response)) return;
  const validationError = validateTarget(request.body);
  if (validationError) {
    response.status(400).json({ error: validationError });
    return;
  }
  const target = request.body;
  const result = await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const current = await client.query("SELECT name, url, headers FROM mikage.targets WHERE key=$1 FOR UPDATE", [request.params.key]);
      if (current.rowCount === 0) {
        await client.query("ROLLBACK");
        return { notFound: true };
      }
      const currentTarget = current.rows[0];
      const headers = target.headers === null ? null : JSON.stringify(target.headers);
      const changedFields = [];
      if (currentTarget.name !== target.name.trim()) changedFields.push("name");
      if (currentTarget.url !== target.url) changedFields.push("url");
      if (JSON.stringify(currentTarget.headers) !== JSON.stringify(target.headers)) changedFields.push("headers");
      if (changedFields.length > 0) {
        await client.query(
          "UPDATE mikage.targets SET name=$2,url=$3,headers=$4::jsonb WHERE key=$1",
          [request.params.key, target.name.trim(), target.url, headers]
        );
        await client.query(
          "INSERT INTO mikage.target_change_audit (target_key, operation, changed_fields) VALUES ($1,'update',$2::text[])",
          [request.params.key, changedFields]
        );
      }
      await client.query("COMMIT");
      return { notFound: false, changedFields };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
  if (result.notFound) {
    response.status(404).json({ error: "targetが見つかりません。" });
    return;
  }
  response.json({ saved: true, changed_fields: result.changedFields });
});

adminRouter.patch("/v1/admin/targets/:key/enabled", requireAllowedAdminHost, async (request, response) => {
  if (rejectCrossOrigin(request, response)) return;
  if (!request.body || Object.keys(request.body).length !== 1 || typeof request.body.is_enabled !== "boolean") {
    response.status(400).json({ error: "is_enabledはbooleanである必要があります。" });
    return;
  }
  const isEnabled = request.body.is_enabled;
  const result = await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const current = await client.query("SELECT url, headers, is_enabled FROM mikage.targets WHERE key=$1 FOR UPDATE", [request.params.key]);
      if (current.rowCount === 0) {
        await client.query("ROLLBACK");
        return { found: false, changed: false };
      }
      const currentTarget = current.rows[0];
      if (isEnabled && (!validateTargetUrl(currentTarget.url, config.allowedTargetHosts) || !isValidTargetHeaders(currentTarget.headers))) {
        await client.query("ROLLBACK");
        return { found: true, changed: false, invalidTarget: true };
      }
      if (currentTarget.is_enabled === isEnabled) {
        await client.query("COMMIT");
        return { found: true, changed: false };
      }
      await client.query("UPDATE mikage.targets SET is_enabled=$2 WHERE key=$1", [request.params.key, isEnabled]);
      await client.query(
        "INSERT INTO mikage.target_change_audit (target_key, operation, changed_fields) VALUES ($1,$2,$3::text[])",
        [request.params.key, isEnabled ? "enable" : "disable", ["is_enabled"]]
      );
      await client.query("COMMIT");
      return { found: true, changed: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
  if (!result.found) {
    response.status(404).json({ error: "targetが見つかりません。" });
    return;
  }
  if (result.invalidTarget) {
    response.status(400).json({ error: "targetのURLまたはheadersが許可されていません。" });
    return;
  }
  response.json({ saved: true, is_enabled: isEnabled, changed: result.changed });
});
