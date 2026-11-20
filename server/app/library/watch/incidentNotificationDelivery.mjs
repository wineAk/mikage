import {
  areExternalNotificationsEnabled,
  isPreviewNotificationMockEnabled,
  getPreviewNotificationFailureMode,
} from "./notificationEnvironment.mjs";
import {
  PreviewNotificationAbortError,
  PreviewNotificationApiFailureError,
  buildPreviewGoogleChatThreadName,
  buildPreviewInstatusId,
  buildPreviewInstatusUrl,
} from "./previewNotification.mjs";

function assertRealNotificationNetworkAllowed(environment) {
  if (!areExternalNotificationsEnabled(environment)) {
    throw new Error("External notification network calls are disabled in this environment.");
  }
}

export async function deliverActiveIncidentNotifications({
  environment,
  label,
  errors,
  incident,
  pageId,
  component,
  serviceName,
  now,
  instatusClients,
  googleChatClients,
}) {
  const useReal = areExternalNotificationsEnabled(environment);
  const useMock = isPreviewNotificationMockEnabled(environment);
  if (!useReal && !useMock) {
    return {
      instatusId: incident.instatus_id,
      googleChatName: incident.googlechat_name,
      instatusUrl: null,
      delivered: false,
    };
  }

  let instatusId = incident.instatus_id;
  let googleChatName = incident.googlechat_name;
  let instatusUrl = null;

  if (useMock) {
    const failureMode = getPreviewNotificationFailureMode(environment);
    if (failureMode === "api_failure") {
      throw new PreviewNotificationApiFailureError();
    }

    if (!instatusId) {
      instatusId = buildPreviewInstatusId(label);
    }
    instatusUrl = buildPreviewInstatusUrl(label, instatusId);

    if (!googleChatName) {
      googleChatName = buildPreviewGoogleChatThreadName(label);
    }

    if (failureMode === "after_notification_before_db") {
      throw new PreviewNotificationAbortError();
    }

    return {
      instatusId,
      googleChatName,
      instatusUrl,
      delivered: true,
      mode: "preview_mock",
    };
  }

  assertRealNotificationNetworkAllowed(environment);

  if (pageId && component) {
    if (!instatusId) {
      const instatusResult = await instatusClients.createIncident({
        started: new Date(incident.created_at).toISOString(),
        page_id: pageId,
        components: [component],
        serviceName,
      });
      instatusId = instatusResult?.incident?.id ?? instatusResult?.id ?? null;
    } else {
      const instatusResult = await instatusClients.updateIncident(instatusId, {
        started: now.toISOString(),
        page_id: pageId,
        components: [component],
      });
      instatusId = instatusResult?.incident?.id ?? instatusResult?.id ?? instatusId;
    }
  }

  if (instatusId) {
    instatusUrl = buildPreviewInstatusUrl(label, instatusId);
  }

  if (!googleChatName) {
    const googleChatResult = await googleChatClients.createThread(errors, instatusUrl);
    googleChatName = googleChatResult?.thread?.name ?? null;
    if (googleChatName) {
      await googleChatClients.updateThread(errors, googleChatName);
    }
  } else {
    await googleChatClients.updateThread(errors, googleChatName);
  }

  return {
    instatusId,
    googleChatName,
    instatusUrl,
    delivered: true,
    mode: "production",
  };
}

export async function deliverResolvedIncidentNotifications({
  environment,
  incident,
  pageId,
  component,
  now,
  instatusClients,
  googleChatClients,
}) {
  const useReal = areExternalNotificationsEnabled(environment);
  const useMock = isPreviewNotificationMockEnabled(environment);
  if (!useReal && !useMock) {
    return { delivered: false };
  }

  if (useMock) {
    const failureMode = getPreviewNotificationFailureMode(environment);
    if (failureMode === "api_failure") {
      throw new PreviewNotificationApiFailureError();
    }
    if (failureMode === "after_notification_before_db") {
      throw new PreviewNotificationAbortError();
    }
    return { delivered: true, mode: "preview_mock" };
  }

  assertRealNotificationNetworkAllowed(environment);

  if (incident.googlechat_name) {
    await googleChatClients.resolveThread([], incident.googlechat_name);
  }
  if (incident.instatus_id && pageId && component) {
    await instatusClients.resolveIncident(incident.instatus_id, {
      started: now.toISOString(),
      page_id: pageId,
      components: [component],
    });
  }

  return { delivered: true, mode: "production" };
}