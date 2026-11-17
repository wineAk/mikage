const allowedHeaderName = /^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/;

export function isValidTargetHeaders(headers) {
  if (headers === null) return true;
  if (typeof headers !== "object" || Array.isArray(headers)) return false;
  const entries = Object.entries(headers);
  if (entries.length > 100 || entries.some(([name, value]) => !allowedHeaderName.test(name) || typeof value !== "string" || /[\r\n]/.test(value))) return false;
  return Buffer.byteLength(JSON.stringify(headers), "utf8") <= 8192;
}
