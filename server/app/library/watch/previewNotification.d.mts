export declare class PreviewNotificationAbortError extends Error {
  constructor(message?: string);
  readonly name: "PreviewNotificationAbortError";
}

export declare class PreviewNotificationApiFailureError extends Error {
  constructor(message?: string);
  readonly name: "PreviewNotificationApiFailureError";
}

export declare function buildPreviewInstatusId(keyword: string): string;

export declare function buildPreviewGoogleChatThreadName(keyword: string): string;

export declare function buildPreviewInstatusUrl(label: string, instatusId: string): string;
