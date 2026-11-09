import assert from "node:assert/strict";
import test from "node:test";
import { canReuseLogWindow, createLogWindow, filterLogWindow } from "./logWindow.ts";

function group(timestamps) {
  return [{ key: "example", name: "Example", extra: "preserved", logs: timestamps.map((created_at, index) => ({
    created_at, response_time: index === 0 ? 0 : null, status_code: index === 0 ? 200 : null,
    status_message: null, error_code: null, error_name: null, extra: index,
  })) }];
}

test("creates a covering interval and rejects reuse after expiry or clock rollback", () => {
  const now = new Date("2026-11-07T01:00:00.000Z");
  const window = createLogWindow(60, now);
  assert.deepEqual(window, { start: "2026-11-07T00:00:00.000Z", end: "2026-11-07T01:01:00.000Z" });
  assert.equal(canReuseLogWindow(window, 60, now), true);
  assert.equal(canReuseLogWindow(window, 60, new Date("2026-11-07T01:01:00.000Z")), true);
  assert.equal(canReuseLogWindow(window, 60, new Date("2026-11-07T01:01:00.001Z")), false);
  assert.equal(canReuseLogWindow(window, 60, new Date("2026-11-07T00:59:59.999Z")), false);
  assert.equal(canReuseLogWindow(window, 61, now), false);
});

test("moves the time window without DB changes and includes future rows only when due", () => {
  const rows = group(["2026-11-07T00:00:00.000Z", "2026-11-07T00:00:30.000Z", "2026-11-07T01:00:30.000Z"]);
  assert.deepEqual(filterLogWindow(rows, 60, new Date("2026-11-07T01:00:00.000Z"))[0].logs.map(row => row.extra), [0, 1]);
  assert.deepEqual(filterLogWindow(rows, 60, new Date("2026-11-07T01:00:30.000Z"))[0].logs.map(row => row.extra), [1, 2]);
});

test("preserves microseconds and nanoseconds at both inclusive and exclusive bounds", () => {
  const rows = group([
    "2026-11-07T00:00:00.000000001Z", "2026-11-07T00:00:00.000000000Z",
    "2026-11-07T00:00:59.999999999Z", "2026-11-07T00:01:00.000000000Z",
    "2026-11-07T00:01:00.000000001Z",
  ]);
  const now = new Date("2026-11-07T00:01:00.000Z");
  assert.deepEqual(filterLogWindow(rows, 1, now)[0].logs.map(row => row.extra), [0, 1, 2, 3]);
  assert.deepEqual(filterLogWindow(rows, 1, now, { includeStart: false, includeEnd: false })[0].logs.map(row => row.extra), [0, 2]);
  assert.deepEqual(filterLogWindow(rows, 1, now, { includeStart: true, includeEnd: false })[0].logs.map(row => row.extra), [0, 1, 2]);
});

test("compares offset timestamps and pre-epoch fractions without changing raw fields", () => {
  const rows = group(["1970-01-01T09:00:00.000000+09:00", "1969-12-31T23:59:59.999999Z", "1970-01-01T00:00:00.000001Z"]);
  const source = structuredClone(rows);
  const result = filterLogWindow(rows, 1, new Date("1970-01-01T00:00:00.000Z"));
  assert.deepEqual(result[0].logs, rows[0].logs.slice(0, 2));
  assert.equal(result[0].extra, "preserved");
  assert.equal(result[0].logs[0].response_time, 0);
  assert.equal(result[0].logs[1].response_time, null);
  assert.deepEqual(rows, source);
});

test("keeps every group in its input order, including groups without visible rows", () => {
  const rows = [...group(["2026-11-07T01:01:00Z"]), { key: "empty", name: "Empty", logs: [] }];
  const result = filterLogWindow(rows, 60, new Date("2026-11-07T01:00:00Z"));
  assert.deepEqual(result.map(item => item.key), ["example", "empty"]);
  assert.deepEqual(result.map(item => item.logs), [[], []]);
  assert.deepEqual(filterLogWindow([], 60, new Date("2026-11-07T01:00:00Z")), []);
});

test("rejects invalid timestamps and windows so callers can bypass the cache", () => {
  const now = new Date("2026-11-07T01:00:00Z");
  for (const timestamp of ["invalid", "2026-02-30T00:00:00Z", "2026-11-07T24:00:00Z", "2026-11-07T00:00:00.0000000001Z"]) {
    assert.throws(() => filterLogWindow(group([timestamp]), 60, now));
  }
  for (const minute of [-1, 0.1, NaN, Infinity]) assert.throws(() => createLogWindow(minute, now));
  assert.throws(() => createLogWindow(60, new Date("invalid")));
  assert.throws(() => createLogWindow(60, now, -1));
  assert.throws(() => canReuseLogWindow({ start: "2026-11-07T01:00:00Z", end: "2026-11-07T00:00:00Z" }, 60, now));
});
