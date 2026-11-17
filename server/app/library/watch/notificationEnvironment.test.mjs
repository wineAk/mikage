import assert from "node:assert/strict";
import test from "node:test";
import { areExternalNotificationsEnabled, isWatchExecutionEnabled } from "./notificationEnvironment.mjs";

test("Render Previewでは外部通知を送信しない", () => {
  assert.equal(areExternalNotificationsEnabled({ IS_PULL_REQUEST: "true" }), false);
});

test("通常のRender serviceでは外部通知を有効にする", () => {
  assert.equal(areExternalNotificationsEnabled({ IS_PULL_REQUEST: "false" }), true);
  assert.equal(areExternalNotificationsEnabled({}), true);
});

test("Render Previewの監視実行は明示的に有効化するまで停止する", () => {
  assert.equal(isWatchExecutionEnabled({ IS_PULL_REQUEST: "true" }), false);
  assert.equal(isWatchExecutionEnabled({ IS_PULL_REQUEST: "true", MIKAGE_PREVIEW_WATCH_ENABLED: "false" }), false);
  assert.equal(isWatchExecutionEnabled({ IS_PULL_REQUEST: "true", MIKAGE_PREVIEW_WATCH_ENABLED: "true" }), true);
  assert.equal(isWatchExecutionEnabled({ IS_PULL_REQUEST: "false" }), true);
});
