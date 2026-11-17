export function areExternalNotificationsEnabled(environment) {
  return environment.IS_PULL_REQUEST !== "true";
}

export function isWatchExecutionEnabled(environment) {
  return environment.IS_PULL_REQUEST !== "true" || environment.MIKAGE_PREVIEW_WATCH_ENABLED === "true";
}
