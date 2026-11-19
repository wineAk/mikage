export class PreviewNotificationAbortError extends Error {
  constructor(message = "Preview notification succeeded but aborted before DB update.") {
    super(message);
    this.name = "PreviewNotificationAbortError";
  }
}

export class PreviewNotificationApiFailureError extends Error {
  constructor(message = "Preview notification API failure injected.") {
    super(message);
    this.name = "PreviewNotificationApiFailureError";
  }
}

export function buildPreviewInstatusId(keyword) {
  return `preview-mock-instatus-${keyword}`;
}

export function buildPreviewGoogleChatThreadName(keyword) {
  return `spaces/preview-mock-space/threads/preview-mock-${keyword}`;
}

export function buildPreviewInstatusUrl(label, instatusId) {
  const subDomain = label === "works" ? "works" : "saaske";
  return `https://${subDomain}.instatus.com/${instatusId}`;
}
