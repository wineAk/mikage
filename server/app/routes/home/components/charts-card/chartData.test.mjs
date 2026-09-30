import assert from "node:assert/strict";
import test from "node:test";

import { createChartData } from "./chartData.ts";

function createLogGroup(key, samples) {
  return {
    key,
    name: key,
    logs: samples.map(({ time, responseTime }) => ({
      created_at: time,
      response_time: responseTime,
      status_code: responseTime === null ? null : 200,
      status_message: null,
      error_code: null,
      error_name: null,
    })),
  };
}

function timeAt(hour, minute, second = 0, day = 30) {
  return new Date(Date.UTC(2026, 8, day, hour, minute, second)).toISOString();
}

test("sorts samples from separate targets by actual timestamp", () => {
  const chartData = createChartData(
    ["web-a", "web-b"],
    [
      createLogGroup("web-b", [{ time: timeAt(15, 30), responseTime: 200 }]),
      createLogGroup("web-a", [
        { time: timeAt(15, 30), responseTime: 100 },
        { time: timeAt(5, 30), responseTime: 50 },
      ]),
    ]
  );

  assert.deepEqual(
    chartData.data.map((row) => row.timestamp),
    [timeAt(5, 30), timeAt(15, 30)].map((time) => Math.floor(Date.parse(time) / 60_000) * 60_000)
  );
  assert.equal(chartData.data[0]["series-0-0"], 50);
  assert.equal(chartData.data[0]["series-1-0"], undefined);
});

test("uses the latest same-minute result, keeps measured zero, and omits null", () => {
  const chartData = createChartData(
    ["web-a"],
    [
      createLogGroup("web-a", [
        { time: timeAt(15, 30, 10), responseTime: 500 },
        { time: timeAt(15, 30, 50), responseTime: null },
        { time: timeAt(15, 31, 5), responseTime: 0 },
      ]),
    ]
  );

  assert.equal(chartData.data.length, 1);
  assert.equal(chartData.data[0]["series-0-0"], 0);
  assert.equal(chartData.series[0].sampleCount, 1);
});

test("keeps a 19-minute round robin connected and splits a ten-hour gap", () => {
  const chartData = createChartData(
    ["web-a", "web-b"],
    [
      createLogGroup("web-a", [
        { time: timeAt(5, 30), responseTime: 10 },
        { time: timeAt(5, 49), responseTime: 20 },
        { time: timeAt(15, 30), responseTime: 30 },
      ]),
      createLogGroup("web-b", [
        { time: timeAt(5, 40), responseTime: 40 },
        { time: timeAt(5, 59), responseTime: 50 },
      ]),
    ]
  );

  assert.deepEqual(
    chartData.series.map(({ targetKey, sampleCount }) => [targetKey, sampleCount]),
    [["web-a", 2], ["web-a", 1], ["web-b", 2]]
  );
  assert.equal(chartData.data[1]["series-0-0"], undefined);
  assert.equal(chartData.data[1]["series-1-0"], 40);
  assert.equal(chartData.data.at(-1)["series-0-1"], 30);
});

test("does not split at exactly sixty minutes and discards invalid dates", () => {
  const chartData = createChartData(
    ["web-a"],
    [
      createLogGroup("web-a", [
        { time: timeAt(5, 30), responseTime: 10 },
        { time: timeAt(6, 30), responseTime: 20 },
        { time: "not-a-date", responseTime: 30 },
        { time: timeAt(7, 31), responseTime: 40 },
      ]),
    ]
  );

  assert.deepEqual(chartData.series.map(({ sampleCount }) => sampleCount), [2, 1]);
  assert.equal(chartData.data.length, 3);
});
