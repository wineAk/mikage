import assert from "node:assert/strict";
import test from "node:test";

import { parseWatchSlot } from "./watchSlot.mjs";

test("指定されたUTC分スロットを検証して返す", () => {
  const parsed = parseWatchSlot("2026-11-16T11:00:00.000Z");
  assert.equal(parsed?.slotStart, "2026-11-16T11:00:00.000Z");
  assert.equal(parsed?.date.toISOString(), "2026-11-16T11:00:00.000Z");
});

test("未指定なら現在のUTC分へ丸め、不正値は拒否する", () => {
  const current = parseWatchSlot(null, new Date("2026-11-16T11:00:45.123Z"));
  assert.equal(current?.slotStart, "2026-11-16T11:00:00.000Z");
  for (const value of ["", "2026-11-16T11:00:01.000Z", "2026-02-30T11:00:00.000Z"]) {
    assert.equal(parseWatchSlot(value), null, value);
  }
});
