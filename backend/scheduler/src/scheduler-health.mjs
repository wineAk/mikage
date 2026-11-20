const WATCH_SUCCESS_MAX_AGE_MS = 3 * 60 * 1000;
const WATCH_STARTUP_GRACE_MS = 3 * 60 * 1000;
const MAINTENANCE_JOB_GRACE_MS = 15 * 60 * 1000;
const MAINTENANCE_JOBS = [
  { name: "reindex_logs", minute: 5 },
  { name: "reindex_incidents", minute: 7 },
];

export function isWatchSchedulerHealthy(health, now = new Date()) {
  if (health.lastStatus === "failed") return false;
  const lastSuccessAt = Date.parse(health.lastSuccessAt ?? "");
  if (Number.isFinite(lastSuccessAt)) {
    return now.getTime() - lastSuccessAt <= WATCH_SUCCESS_MAX_AGE_MS;
  }
  const startedAt = Date.parse(health.startedAt ?? "");
  return Number.isFinite(startedAt)
    && now.getTime() - startedAt <= WATCH_STARTUP_GRACE_MS;
}

function getMostRecentMaintenanceDueAt(now, minute) {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(dateParts.map(({ type, value }) => [type, value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const currentMonthDueAt = Date.UTC(year, month - 1, 1, 3 - 9, minute);
  if (currentMonthDueAt <= now.getTime()) return currentMonthDueAt;
  return Date.UTC(year, month - 2, 1, 3 - 9, minute);
}

export function isMaintenanceSchedulerHealthy(health, now = new Date()) {
  if (health.lastStatus === "failed") return false;
  const startedAt = Date.parse(health.startedAt ?? "");
  if (!Number.isFinite(startedAt)) return false;
  const jobSuccessAt = health.jobSuccessAt ?? {};

  return MAINTENANCE_JOBS.every(({ name, minute }) => {
    const dueAt = getMostRecentMaintenanceDueAt(now, minute);
    if (startedAt > dueAt || now.getTime() - dueAt <= MAINTENANCE_JOB_GRACE_MS) return true;
    const lastSuccessAt = Date.parse(jobSuccessAt[name] ?? "");
    return Number.isFinite(lastSuccessAt) && lastSuccessAt >= dueAt;
  });
}

export function writeSchedulerHealthResponse(response, health, isHealthy = health.lastStatus !== "failed") {
  const statusCode = isHealthy ? 200 : 503;
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify({ status: isHealthy ? "ok" : "degraded", ...health }));
}
