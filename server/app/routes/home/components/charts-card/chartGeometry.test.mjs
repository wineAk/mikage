import assert from "node:assert/strict";
import test from "node:test";
import { createChartGeometry, findNearestDataIndex, getMeasuredValues } from "./chartGeometry.ts";

const series = [
  { dataKey: "a-0", targetKey: "a", sampleCount: 2 },
  { dataKey: "a-1", targetKey: "a", sampleCount: 1 },
  { dataKey: "b-0", targetKey: "b", sampleCount: 1 },
];
const data = [
  { timestamp: 0, created_at: "", "a-0": 0, "b-0": 3000 },
  { timestamp: 100, created_at: "", "a-0": 1000 },
  { timestamp: 900, created_at: "", "a-1": 4000 },
];

test("preserves zero, all points, separate gap segments and singleton geometry", () => {
  const geometry = createChartGeometry(data, series, { start: 0, end: 1000 }, 500);
  assert.equal(geometry.paths.length, 3);
  assert.deepEqual(geometry.paths[0].points.map(point => point.value), [0, 1000]);
  assert.equal(geometry.paths[1].points.length, 1);
  assert.equal(geometry.paths[0].points[0].y, geometry.bottom);
  assert.equal(geometry.paths[1].points[0].y, 12);
  assert.equal(geometry.paths[0].line.split("L").length, 2);
  assert.equal(geometry.paths[1].line.split("L").length, 1);
  assert.equal(geometry.yMaximum, 4000);
});

test("retains every point on long ranges rather than decimating", () => {
  const rows = Array.from({ length: 40_320 }, (_, timestamp) => ({ timestamp, created_at: "", a: timestamp % 100 }));
  const geometry = createChartGeometry(rows, [{ dataKey: "a", targetKey: "a", sampleCount: rows.length }], { start: 0, end: 40_320 }, 300);
  assert.equal(geometry.paths[0].points.length, rows.length);
  assert.equal((geometry.paths[0].line.match(/[ML]/g) ?? []).length, rows.length);
});

test("finds nearest actual timestamp at edges, midpoints and empty input", () => {
  assert.equal(findNearestDataIndex([], 20), -1);
  assert.equal(findNearestDataIndex(data, -100), 0);
  assert.equal(findNearestDataIndex(data, 1000), 2);
  assert.equal(findNearestDataIndex(data, 40), 0);
  assert.equal(findNearestDataIndex(data, 60), 1);
  assert.equal(findNearestDataIndex(data, 500), 1);
});

test("tooltip includes measured zero, omits missing values and sorts descending", () => {
  assert.deepEqual(getMeasuredValues(data[0], series).map(item => [item.targetKey, item.value]), [["b", 3000], ["a", 0]]);
  const geometry = createChartGeometry([], [], { start: 0, end: 0 }, 0);
  assert.equal(Number.isFinite(geometry.plotWidth), true);
  assert.equal(geometry.yMaximum, 100);
});
