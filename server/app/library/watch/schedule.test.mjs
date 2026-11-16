import assert from "node:assert/strict";
import test from "node:test";

import { getWatchSchedule } from "./schedule.ts";

const originalPeriods = process.env.WATCH_REDUCED_POLLING_PERIODS;
const originalFetch = globalThis.fetch;

function atJst(dateTime) {
  return new Date(`${dateTime}+09:00`);
}

function setPeriods(value) {
  if (value === undefined) {
    delete process.env.WATCH_REDUCED_POLLING_PERIODS;
  } else {
    process.env.WATCH_REDUCED_POLLING_PERIODS = value;
  }
}

test.after(() => {
  setPeriods(originalPeriods);
  globalThis.fetch = originalFetch;
});

test("既定の年末年始は両端を含めて巡回する", async () => {
  setPeriods(undefined);
  globalThis.fetch = () => { throw new Error("祝日 API にアクセスしてはならない"); };

  for (const dateTime of [
    "2026-12-29T00:00:00",
    "2026-12-30T12:00:00",
    "2026-12-31T12:00:00",
    "2027-01-01T12:00:00",
    "2027-01-03T23:59:59",
    "2028-01-03T12:00:00",
  ]) {
    assert.deepEqual(await getWatchSchedule(atJst(dateTime)), {
      mode: "round_robin",
      reason: dateTime.startsWith("2027-01-03") ? "low_traffic" : "closure_period",
    });
  }
});

test("休暇外の平日と5分間隔の従来判定を保つ", async () => {
  setPeriods(undefined);
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ holidays: [] }),
  });

  assert.deepEqual(await getWatchSchedule(atJst("2026-12-28T23:59:00")), {
    mode: "round_robin",
    reason: "low_traffic",
  });
  assert.deepEqual(await getWatchSchedule(atJst("2027-01-04T09:00:00")), {
    mode: "all",
    reason: "business_hours",
  });
  assert.deepEqual(await getWatchSchedule(atJst("2027-01-04T08:01:00")), {
    mode: "skip",
    reason: "reduced_business_hours_interval",
  });
});

test("設定した年跨ぎ・複数の休暇期間だけを巡回する", async () => {
  setPeriods(" 2026-12-28 / 2027-01-04 , 2027-08-10 / 2027-08-13 ");
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ holidays: [] }),
  });

  for (const dateTime of [
    "2026-12-28T00:00:00",
    "2027-01-04T23:59:59",
    "2027-08-10T09:00:00",
    "2027-08-13T17:59:59",
  ]) {
    assert.deepEqual(await getWatchSchedule(atJst(dateTime)), {
      mode: "round_robin",
      reason: "closure_period",
    });
  }
  assert.deepEqual(await getWatchSchedule(atJst("2027-08-09T09:00:00")), {
    mode: "all",
    reason: "business_hours",
  });
});

test("不正な日付や期間では全件監視せず、同じ設定の警告は1回だけ", async () => {
  const originalError = console.error;
  const messages = [];
  console.error = (message) => messages.push(message);
  globalThis.fetch = () => { throw new Error("祝日 API にアクセスしてはならない"); };

  try {
    for (const invalidPeriods of [
      "2027-02-29/2027-03-03",
      "2027-08-13/2027-08-10",
      "2027-08-10",
      "",
    ]) {
      setPeriods(invalidPeriods);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        assert.deepEqual(await getWatchSchedule(atJst("2027-08-10T10:00:00")), {
          mode: "round_robin",
          reason: "closure_config_invalid",
        });
      }
    }
    assert.equal(messages.length, 4);
  } finally {
    console.error = originalError;
  }
});

test("閏日の期間を受け入れ、設定を変更すると再評価する", async () => {
  setPeriods("2028-02-29/2028-02-29");
  globalThis.fetch = () => { throw new Error("祝日 API にアクセスしてはならない"); };
  assert.deepEqual(await getWatchSchedule(atJst("2028-02-29T09:00:00")), {
    mode: "round_robin",
    reason: "closure_period",
  });

  setPeriods("2028-03-01/2028-03-01");
  assert.deepEqual(await getWatchSchedule(atJst("2028-03-01T09:00:00")), {
    mode: "round_robin",
    reason: "closure_period",
  });
});
