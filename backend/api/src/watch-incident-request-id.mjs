export function isValidWatchIncidentRequestId(value) {
  return typeof value === "string" && /^[A-Za-z0-9:_.-]{1,160}$/.test(value);
}