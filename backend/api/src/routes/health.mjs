import { Router } from "express";
import { pool } from "../db.mjs";

export const healthRouter = Router();

healthRouter.get("/health", async (_request, response) => {
  try {
    await pool.query("SELECT 1");
    response.json({ status: "ok" });
  } catch {
    response.status(503).json({ status: "degraded", error: "データベースに接続できません。" });
  }
});