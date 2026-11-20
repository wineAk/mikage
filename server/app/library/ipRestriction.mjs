export function isRequestIpAllowed(requestIp, allowedIps) {
  if (typeof requestIp !== "string" || !Array.isArray(allowedIps) || allowedIps.length === 0) return false;
  return allowedIps.includes(requestIp.trim());
}
