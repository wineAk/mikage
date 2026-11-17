import http from "node:http";
import pg from "pg";
import { setTimeout as sleep } from "node:timers/promises";
import { getMaintenanceJob, runMaintenanceJob } from "./maintenance-scheduler.mjs";
import { millisecondsUntilNextMinute } from "./watch-scheduler.mjs";
import { isMaintenanceSchedulerHealthy, writeSchedulerHealthResponse } from "./scheduler-health.mjs";
import { loadSchedulerState, saveSchedulerState } from "./scheduler-state.mjs";

const pool = new pg.Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT ?? "5432"),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  max: 1,
  connectionTimeoutMillis: 5_000,
});
const port = Number(process.env.HEALTH_PORT ?? "3200");
const stateFilePath = process.env.HEALTH_STATE_FILE ?? "/var/lib/mikage-maintenance/state.json";
const health = await loadSchedulerState(stateFilePath, {
  startedAt: new Date().toISOString(),
  lastJob: null,
  lastRunAt: null,
  lastStatus: null,
  jobSuccessAt: {},
});
health.jobSuccessAt ??= {};
if (health.lastJob && health.lastRunAt && health.lastStatus === "succeeded") {
  health.jobSuccessAt[health.lastJob] ??= health.lastRunAt;
}
await saveSchedulerState(stateFilePath, health);
const healthServer = http.createServer((request, response) => {
  if (request.method !== "GET" || request.url !== "/health") {
    response.writeHead(404).end();
    return;
  }
  writeSchedulerHealthResponse(response, health, isMaintenanceSchedulerHealthy(health));
});

await new Promise((resolve, reject) => {
  healthServer.once("error", reject);
  healthServer.listen(port, "127.0.0.1", resolve);
});

let stopping = false;
const stop = async () => {
  stopping = true;
  healthServer.close();
  await pool.end();
};
async function persistHealth() {
  try {
    await saveSchedulerState(stateFilePath, health);
  } catch {
    health.lastStatus = "failed";
    health.lastErrorName = "SchedulerStatePersistenceError";
    console.error(JSON.stringify({ event: "maintenance_health_state_failed" }));
  }
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

while (!stopping) {
  await sleep(millisecondsUntilNextMinute());
  if (stopping) break;
  const job = getMaintenanceJob(new Date());
  if (!job) continue;

  health.lastJob = job;
  health.lastRunAt = new Date().toISOString();
  try {
    const result = await runMaintenanceJob(job, pool);
    health.lastStatus = "succeeded";
    health.jobSuccessAt[job] = health.lastRunAt;
    delete health.lastErrorName;
    console.info(JSON.stringify({ event: "maintenance_succeeded", job, at: health.lastRunAt, ...result }));
  } catch (error) {
    health.lastStatus = "failed";
    health.lastErrorName = error instanceof Error ? error.name : "UnknownError";
    console.error(JSON.stringify({ event: "maintenance_failed", job, at: health.lastRunAt, error: health.lastErrorName }));
  }
  await persistHealth();
}
