import assert from "node:assert/strict";
import test from "node:test";
import { getWatchSlotStart, millisecondsUntilNextMinute, parseWatchConfig, runWatchTick } from "./watch-scheduler.mjs";

test("Render watch URLは固定pathのHTTPSでquery secretを受け付けない", () => {
  const valid = parseWatchConfig({
    WATCH_SCHEDULER_ENABLED: "true",
    MIKAGE_RENDER_WATCH_URL: "https://mikage.example/api/v1/watch",
    MIKAGE_WATCH_EXECUTE_TOKEN: "test-secret",
  });
  assert.equal(valid.watchUrl.pathname, "/api/v1/watch");
  assert.equal(valid.token, "test-secret");
  for (const url of [
    "http://mikage.example/api/v1/watch",
    "https://mikage.example/api/v1/watch?key=secret",
    "https://mikage.example/other",
    "https://user:pass@mikage.example/api/v1/watch",
  ]) {
    assert.throws(() => parseWatchConfig({ WATCH_SCHEDULER_ENABLED: "true", MIKAGE_RENDER_WATCH_URL: url, MIKAGE_WATCH_EXECUTE_TOKEN: "test-secret" }));
  }
  assert.throws(() => parseWatchConfig({ WATCH_SCHEDULER_ENABLED: "true", MIKAGE_RENDER_WATCH_URL: "https://mikage.example/api/v1/watch" }));
});

test("watch schedulerは有効化値を厳密に判定し、不正値で有効にならない", () => {
  assert.equal(parseWatchConfig({ WATCH_SCHEDULER_ENABLED: "false" }), null);
  for (const enabled of [undefined, "", "False", "yes", "1"]) {
    assert.throws(() => parseWatchConfig({ WATCH_SCHEDULER_ENABLED: enabled }), /trueまたはfalse/);
  }
});

test("Render起動はBearer headerを使い、response本文やtokenを記録しない", async () => {
  let captured;
  const result = await runWatchTick({
    watchUrl: new URL("https://mikage.example/api/v1/watch"),
    token: "test-secret",
    slotStart: "2026-11-16T11:00:00.000Z",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { ok: true, status: 200 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(captured.options.method, "GET");
  assert.equal(captured.options.headers.Authorization, "Bearer test-secret");
  assert.equal(captured.options.headers["X-Mikage-Watch-Slot"], "2026-11-16T11:00:00.000Z");
  assert.equal(captured.options.cache, "no-store");
  assert.equal(captured.url.search, "");
});

test("watch schedulerは次の分境界を待ち、同じ分で再実行しない", () => {
  assert.equal(millisecondsUntilNextMinute(0), 60_000);
  assert.equal(millisecondsUntilNextMinute(1), 59_999);
  assert.equal(millisecondsUntilNextMinute(59_999), 1);
  assert.equal(millisecondsUntilNextMinute(60_000), 60_000);
});

test("失敗したtickは同じslotを次回へ引き継ぎ、再起動後は現在slotから始める", () => {
  assert.equal(getWatchSlotStart(null, new Date("2026-11-16T11:01:45.000Z")), "2026-11-16T11:01:00.000Z");
  assert.equal(getWatchSlotStart("2026-11-16T11:00:00.000Z", new Date("2026-11-16T11:01:45.000Z")), "2026-11-16T11:00:00.000Z");
  assert.equal(getWatchSlotStart("invalid", new Date("2026-11-16T11:01:45.000Z")), "2026-11-16T11:01:00.000Z");
});
