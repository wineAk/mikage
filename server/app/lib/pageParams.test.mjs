import assert from "node:assert/strict";
import test from "node:test";
import { homeMinutes, MAX_MONTH_OFFSET, minuteValue, readHomeMinute, readMonthOffset } from "./pageParams.ts";

test("accepts only the existing bounded period choices", () => {
  for (const value of homeMinutes) assert.equal(readHomeMinute(value), value);
  for (const value of [null, "", "-1", "99999999999", "60*24*999", "NaN", "Infinity"]) assert.equal(readHomeMinute(value), "60*1");
  assert.equal(minuteValue("60*24*28"), 40_320);
  assert.equal(minuteValue("99999999999"), 60);
});

test("bounds month offsets without permitting negative or arbitrary expressions", () => {
  assert.equal(readMonthOffset("3"), 3);
  assert.equal(readMonthOffset(String(MAX_MONTH_OFFSET)), MAX_MONTH_OFFSET);
  assert.equal(readMonthOffset("9".repeat(1000)), MAX_MONTH_OFFSET);
  for (const value of [null, "-1", "1.5", "1*2", "Infinity", "invalid"]) assert.equal(readMonthOffset(value), 0);
});
