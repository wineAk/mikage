import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { getWatchSlotStart, millisecondsUntilNextMinute, parseWatchConfig, runWatchTick } from "./watch-scheduler.mjs";
import { isWatchSchedulerHealthy, writeSchedulerHealthResponse } from "./scheduler-health.mjs";
import { loadSchedulerState, saveSchedulerState } from "./scheduler-state.mjs";

const watchConfig = parseWatchConfig(process.env);
const schedulerEnabled = watchConfig !== null;
const port = Number(process.env.HEALTH_PORT ?? "3200");
const stateFilePath = process.env.HEALTH_STATE_FILE ?? "/var/lib/mikage-watch/state.json";
const health = await loadSchedulerState(stateFilePath, {
  startedAt: new Date().toISOString(),
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastStatus: null,
  pendingSlotStart: null,
});
health.pendingSlotStart = null;
await saveSchedulerState(stateFilePath, health);
const healthServer = http.createServer((request, response) => {
  if (request.method !== "GET" || request.url !== "/health") {
    response.writeHead(404).end();
    return;
  }
  writeSchedulerHealthResponse(response, health, !schedulerEnabled || isWatchSchedulerHealthy(health));
});

await new Promise((resolve, reject) => {
  healthServer.once("error", reject);
  healthServer.listen(port, "127.0.0.1", resolve);
});

let stopping = false;
let resolveDisabled;
const stop = () => {
  stopping = true;
  healthServer.close();
  resolveDisabled?.();
};
async function persistHealth() {
  try {
    await saveSchedulerState(stateFilePath, health);
  } catch {
    health.lastStatus = "failed";
    health.lastErrorName = "SchedulerStatePersistenceError";
    console.error(JSON.stringify({ event: "watch_health_state_failed" }));
  }
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

if (!watchConfig) {
  console.info(JSON.stringify({ event: "watch_scheduler_disabled" }));
  await new Promise((resolve) => {
    resolveDisabled = resolve;
    if (stopping) resolve();
  });
}

while (!stopping) {
  await sleep(millisecondsUntilNextMinute());
  if (stopping) break;

  const slotStart = getWatchSlotStart(health.pendingSlotStart);
  health.pendingSlotStart = slotStart;
  health.lastAttemptAt = new Date().toISOString();
  try {
    const result = await runWatchTick({ ...watchConfig, slotStart });
    health.lastStatus = result.ok ? "succeeded" : "failed";
    health.lastHttpStatus = result.status;
    delete health.lastErrorName;
    if (result.ok) {
      health.pendingSlotStart = null;
      health.lastSuccessAt = health.lastAttemptAt;
      console.info(JSON.stringify({ event: "watch_tick_succeeded", at: health.lastAttemptAt, status: result.status }));
    } else {
      console.error(JSON.stringify({ event: "watch_tick_failed", at: health.lastAttemptAt, status: result.status }));
    }
  } catch (error) {
    health.lastStatus = "failed";
    health.lastErrorName = error instanceof Error ? error.name : "UnknownError";
    console.error(JSON.stringify({ event: "watch_tick_failed", at: health.lastAttemptAt, error: health.lastErrorName }));
  }
  await persistHealth();
}
