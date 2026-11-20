import assert from "node:assert/strict";
import test from "node:test";
import {
  isMaintenanceSchedulerHealthy,
  isWatchSchedulerHealthy,
  writeSchedulerHealthResponse,
} from "./scheduler-health.mjs";

function createResponse() {
  return {
    headers: null,
    body: null,
    statusCode: null,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body) {
      this.body = JSON.parse(body);
    },
  };
}

test("未実行または成功済みならhealthcheckをhealthyにする", () => {
  for (const health of [
    { lastAttemptAt: null, lastSuccessAt: null, lastStatus: null },
    { lastAttemptAt: "2026-11-17T00:00:00.000Z", lastStatus: "succeeded" },
  ]) {
    const response = createResponse();
    writeSchedulerHealthResponse(response, health);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.status, "ok");
    assert.match(response.headers["Cache-Control"], /no-store/);
  }
});

test("直近のscheduler失敗を503 degradedとして通知する", () => {
  const response = createResponse();
  writeSchedulerHealthResponse(response, { lastStatus: "failed", lastErrorName: "TimeoutError" });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.status, "degraded");
  assert.equal(response.body.lastErrorName, "TimeoutError");
});

test("watch schedulerは起動猶予後の未実行と古い最終成功をdegradedにする", () => {
  assert.equal(isWatchSchedulerHealthy({ startedAt: "2026-11-17T00:00:00.000Z" }, new Date("2026-11-17T00:02:59.999Z")), true);
  assert.equal(isWatchSchedulerHealthy({ startedAt: "2026-11-17T00:00:00.000Z" }, new Date("2026-11-17T00:03:00.001Z")), false);
  assert.equal(isWatchSchedulerHealthy({
    startedAt: "2026-11-17T00:02:59.999Z",
    lastSuccessAt: "2026-11-17T00:00:00.000Z",
    lastStatus: "succeeded",
  }, new Date("2026-11-17T00:03:00.001Z")), false);
  assert.equal(isWatchSchedulerHealthy({
    startedAt: "2026-11-17T00:00:00.000Z",
    lastSuccessAt: "2026-11-17T00:02:59.999Z",
    lastStatus: "failed",
  }, new Date("2026-11-17T00:03:00.001Z")), false);
});

test("maintenance schedulerはreindex予定時刻後の猶予中は待ち、未実行が続けばdegradedにする", () => {
  const health = {
    startedAt: "2026-11-01T02:00:00+09:00",
    lastStatus: "succeeded",
    jobSuccessAt: {
      reindex_logs: "2026-11-01T03:05:00+09:00",
      reindex_incidents: "2026-11-01T03:07:00+09:00",
    },
  };

  assert.equal(isMaintenanceSchedulerHealthy(health, new Date("2026-11-01T03:21:59+09:00")), true);
  assert.equal(isMaintenanceSchedulerHealthy(health, new Date("2026-11-01T03:22:01+09:00")), true);
  delete health.jobSuccessAt.reindex_incidents;
  assert.equal(isMaintenanceSchedulerHealthy(health, new Date("2026-11-01T03:22:01+09:00")), false);
});

test("maintenance schedulerの停止中に過ぎたjobはcatch-upせずhealthで検出する", () => {
  const health = {
    startedAt: "2026-11-01T03:30:00+09:00",
    lastStatus: null,
    jobSuccessAt: {},
  };

  assert.equal(isMaintenanceSchedulerHealthy(health, new Date("2026-11-01T04:00:00+09:00")), true);
});
