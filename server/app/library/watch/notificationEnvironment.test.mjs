import assert from "node:assert/strict";
import test from "node:test";
import {
  areExternalNotificationsEnabled,
  getPreviewNotificationFailureMode,
  isPreviewNotificationMockEnabled,
  isWatchExecutionEnabled,
} from "./notificationEnvironment.mjs";

test("Render Previewでは外部通知を送信しない", () => {
  assert.equal(areExternalNotificationsEnabled({ IS_PULL_REQUEST: "true" }), false);
});

test("通常のRender serviceでは外部通知を有効にする", () => {
  assert.equal(areExternalNotificationsEnabled({ IS_PULL_REQUEST: "false" }), true);
  assert.equal(areExternalNotificationsEnabled({}), true);
});

test("Preview通知mockはPR Previewかつ明示有効化時のみ有効", () => {
  assert.equal(isPreviewNotificationMockEnabled({ IS_PULL_REQUEST: "true" }), false);
  assert.equal(
    isPreviewNotificationMockEnabled({ IS_PULL_REQUEST: "true", MIKAGE_PREVIEW_NOTIFICATION_MOCK: "true" }),
    true,
  );
  assert.equal(
    isPreviewNotificationMockEnabled({ IS_PULL_REQUEST: "false", MIKAGE_PREVIEW_NOTIFICATION_MOCK: "true" }),
    false,
  );
});

test("failure injection modeはPreview mock時だけ有効", () => {
  assert.equal(
    getPreviewNotificationFailureMode({
      IS_PULL_REQUEST: "true",
      MIKAGE_PREVIEW_NOTIFICATION_MOCK: "true",
      MIKAGE_PREVIEW_NOTIFICATION_FAILURE_MODE: "api_failure",
    }),
    "api_failure",
  );
  assert.equal(
    getPreviewNotificationFailureMode({
      IS_PULL_REQUEST: "false",
      MIKAGE_PREVIEW_NOTIFICATION_MOCK: "true",
      MIKAGE_PREVIEW_NOTIFICATION_FAILURE_MODE: "api_failure",
    }),
    null,
  );
  assert.equal(
    getPreviewNotificationFailureMode({
      IS_PULL_REQUEST: "true",
      MIKAGE_PREVIEW_NOTIFICATION_FAILURE_MODE: "after_notification_before_db",
    }),
    null,
  );
});

test("Render Previewの監視実行は明示的に有効化するまで停止する", () => {
  assert.equal(isWatchExecutionEnabled({ IS_PULL_REQUEST: "true" }), false);
  assert.equal(isWatchExecutionEnabled({ IS_PULL_REQUEST: "true", MIKAGE_PREVIEW_WATCH_ENABLED: "false" }), false);
  assert.equal(isWatchExecutionEnabled({
    IS_PULL_REQUEST: "true",
    MIKAGE_PREVIEW_WATCH_ENABLED: "true",
    MIKAGE_PREVIEW_NOTIFICATION_MOCK: "true",
  }), false);
  assert.equal(isWatchExecutionEnabled({
    IS_PULL_REQUEST: "true",
    MIKAGE_PREVIEW_WATCH_ENABLED: "true",
    MIKAGE_PREVIEW_NOTIFICATION_MOCK: "true",
    MIKAGE_GATEWAY_APP: "mikage",
  }), false);
  assert.equal(isWatchExecutionEnabled({
    IS_PULL_REQUEST: "true",
    MIKAGE_PREVIEW_WATCH_ENABLED: "true",
    MIKAGE_PREVIEW_NOTIFICATION_MOCK: "true",
    MIKAGE_GATEWAY_APP: "mikage-staging",
  }), true);
  assert.equal(isWatchExecutionEnabled({ IS_PULL_REQUEST: "false" }), true);
});
