import express from "express";
import { pool } from "./db.mjs";
import { healthRouter } from "./routes/health.mjs";
import { monitoringTargetsRouter } from "./routes/monitoring-targets.mjs";
import { watchReservationsRouter } from "./routes/watch-reservations.mjs";
import { watchResultsRouter } from "./routes/watch-results.mjs";
import { viewRouter } from "./routes/view.mjs";
import { adminRouter } from "./routes/admin.mjs";
import { watchIncidentsRouter } from "./routes/watch-incidents.mjs";
import { isAllowedAdminHost, isAdminRequestPath } from "./admin-host.mjs";
import { config } from "./config.mjs";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    if (isAdminRequestPath(request.path) && !isAllowedAdminHost(request.get("host"), config.allowedAdminHosts)) {
      response.status(404).json({ error: "見つかりません。" });
      return;
    }
    next();
  });
  app.use(async (request, response, next) => {
    if (request.path === "/health") {
      next();
      return;
    }
    try {
      const { rows } = await pool.query(
        "SELECT data_verified FROM mikage.migration_state WHERE singleton = true"
      );
      if (rows[0]?.data_verified !== true) {
        response.status(503).json({ error: "移行データの照合が完了していません。" });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  });
  app.use(express.json({ limit: "1mb" }));

  app.use(healthRouter);
  app.use(monitoringTargetsRouter);
  app.use(watchReservationsRouter);
  app.use(watchResultsRouter);
  app.use(watchIncidentsRouter);
  app.use(viewRouter);
  app.use(adminRouter);

  app.use((_request, response) => {
    response.status(404).json({ error: "見つかりません。" });
  });

  app.use((error, _request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    if (error?.type === "entity.parse.failed") {
      response.status(400).json({ error: "JSON形式が不正です。" });
      return;
    }
    if (error?.type === "entity.too.large") {
      response.status(413).json({ error: "リクエスト本文が上限を超えています。" });
      return;
    }
    console.error(
      "監視APIの処理に失敗しました。",
      error instanceof Error ? error.name : "UnknownError",
      typeof error?.code === "string" ? error.code : "",
      typeof error?.table === "string" ? error.table : "",
      typeof error?.column === "string" ? error.column : ""
    );
    response.status(500).json({ error: "リクエストを処理できませんでした。" });
  });

  return app;
}
