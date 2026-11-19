export function areExternalNotificationsEnabled(environment: NodeJS.ProcessEnv): boolean;
export function isPreviewNotificationMockEnabled(environment: NodeJS.ProcessEnv): boolean;
export function getPreviewNotificationFailureMode(environment: NodeJS.ProcessEnv): "api_failure" | "after_notification_before_db" | null;
export function isWatchExecutionEnabled(environment: NodeJS.ProcessEnv): boolean;
