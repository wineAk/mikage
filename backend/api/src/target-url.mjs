export function validateTargetUrl(value, allowedHosts) {
  if (typeof value !== "string" || value.length > 2048) return null;
  let parsedUrl;
  try {
    parsedUrl = new URL(value);
  } catch {
    return null;
  }
  if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password || parsedUrl.hash) return null;
  if (!allowedHosts.has(parsedUrl.hostname.toLowerCase().replace(/\.$/, ""))) return null;
  return parsedUrl;
}
