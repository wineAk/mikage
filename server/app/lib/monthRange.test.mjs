import assert from "node:assert/strict";
import test from "node:test";
import { getJstMonthRange } from "./monthRange.ts";

test("uses the same JST month for every server timezone and leap-year boundary", () => {
  const previousTimezone = process.env.TZ;
  try {
    for (const timezone of ["UTC", "Asia/Tokyo", "America/New_York"]) {
      process.env.TZ = timezone;
      assert.deepEqual(getJstMonthRange(0, new Date("2024-02-29T15:00:00Z")), {
        start: "2024-02-29T15:00:00.000Z", end: "2024-03-31T15:00:00.000Z",
        previousStart: "2024-01-31T15:00:00.000Z", nextEnd: "2024-04-30T15:00:00.000Z",
      });
    }
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test("handles year rollover and rejects invalid month offsets", () => {
  assert.equal(getJstMonthRange(1, new Date("2026-01-01T00:00:00Z")).start, "2025-11-30T15:00:00.000Z");
  assert.throws(() => getJstMonthRange(-1));
  assert.throws(() => getJstMonthRange(0.5));
});
