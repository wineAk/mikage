export function areExternalNotificationsEnabled(environment) {
  return environment.IS_PULL_REQUEST !== "true";
}

export function isPreviewNotificationMockEnabled(environment) {
  return environment.IS_PULL_REQUEST === "true" && environment.MIKAGE_PREVIEW_NOTIFICATION_MOCK === "true";
}

const PREVIEW_NOTIFICATION_FAILURE_MODES = new Set([
  "api_failure",
  "after_notification_before_db",
]);

export function getPreviewNotificationFailureMode(environment) {
  if (!isPreviewNotificationMockEnabled(environment)) {
    return null;
  }

  const mode = environment.MIKAGE_PREVIEW_NOTIFICATION_FAILURE_MODE;
  return PREVIEW_NOTIFICATION_FAILURE_MODES.has(mode) ? mode : null;
}

export function isWatchExecutionEnabled(environment) {
  return environment.IS_PULL_REQUEST !== "true" || environment.MIKAGE_PREVIEW_WATCH_ENABLED === "true";
}
