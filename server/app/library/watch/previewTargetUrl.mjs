export const PREVIEW_ALLOWED_HOSTS = Object.freeze([
  "api.saaske.com", "my.saaske.com", "www.saaske.com", "works.saaske.com",
  "secure-link.jp", "script.secure-link.jp", "www.interpark.co.jp",
  "kensyo-tes.works.app", "kensyo-tes2.works.app",
]);

const previewAllowedHosts = new Set(PREVIEW_ALLOWED_HOSTS);

export function isAllowedPreviewTargetUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === "https:" && !parsedUrl.username && !parsedUrl.password && !parsedUrl.hash && previewAllowedHosts.has(parsedUrl.hostname.toLowerCase().replace(/\.$/, ""));
  } catch {
    return false;
  }
}
