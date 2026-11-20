import { timingSafeEqual } from "node:crypto";

export function isAuthorizedWatchExecuteRequest(request, expectedToken) {
  if (!expectedToken) return false;
  const provided = Buffer.from(request.headers.get("Authorization") ?? "");
  const expected = Buffer.from(`Bearer ${expectedToken}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
