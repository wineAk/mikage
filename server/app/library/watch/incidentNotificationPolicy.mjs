const INCIDENT_NOTIFICATION_INTERVAL_MS = 5 * 60 * 1000;

export function isIncidentNotificationDue({ isNewIncident, isNotificationPending = false, updatedAt, now }) {
  return isNotificationPending
    || isNewIncident
    || now.getTime() - Date.parse(updatedAt) >= INCIDENT_NOTIFICATION_INTERVAL_MS;
}
