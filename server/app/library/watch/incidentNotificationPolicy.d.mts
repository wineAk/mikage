export function isIncidentNotificationDue(input: {
  isNewIncident: boolean;
  isNotificationPending?: boolean;
  updatedAt: string;
  now: Date;
}): boolean;
