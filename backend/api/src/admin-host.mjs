import { isIP } from "node:net";

export function isAdminRequestPath(requestPath) {
  const normalizedPath = requestPath.replace(/\/+$/, "") || "/";
  return normalizedPath === "/admin"
    || normalizedPath === "/admin.js"
    || normalizedPath === "/v1/admin"
    || normalizedPath.startsWith("/v1/admin/");
}

export function isAllowedAdminHost(hostHeader, allowedHosts) {
  if (typeof hostHeader !== "string" || hostHeader.length === 0) return false;
  let hostname;
  try {
    hostname = new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  const unbracketedHostname = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  const canonicalHostname = unbracketedHostname.replace(/\.$/, "");
  const isLoopbackIpv4 = isIP(canonicalHostname) === 4 && Number(canonicalHostname.split(".")[0]) === 127;
  const isLoopbackHost = canonicalHostname === "localhost"
    || canonicalHostname.endsWith(".localhost")
    || canonicalHostname === "::1"
    || isLoopbackIpv4;
  return !isLoopbackHost && allowedHosts.has(hostname);
}
