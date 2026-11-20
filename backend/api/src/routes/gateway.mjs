import { requireBearerAuth } from "../middleware/auth.mjs";
import { gatewayRouteContracts } from "./gateway-contracts.mjs";

const gatewayPathsByRequest = new Map(
  gatewayRouteContracts.map(({ method, path, apiPath }) => [`${method} ${path}`, apiPath])
);

function isGatewayPath(rawPath) {
  if (hasGatewayMarker(rawPath)) return true;
  try {
    return hasGatewayMarker(decodeURIComponent(rawPath));
  } catch {
    return false;
  }
}

function hasGatewayMarker(path) {
  return path.toLowerCase().startsWith("/gw");
}

function isAllowedGatewayHost(hostHeader, allowedHosts) {
  if (typeof hostHeader !== "string" || hostHeader.length === 0) return false;
  try {
    return allowedHosts.has(new URL(`http://${hostHeader}`).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function gatewayDispatchMiddleware(request, response, next, allowedGatewayHosts = null) {
  const requestUrl = request.url ?? "/";
  const queryIndex = requestUrl.indexOf("?");
  const rawPath = queryIndex === -1 ? requestUrl : requestUrl.slice(0, queryIndex);
  if (!isGatewayPath(rawPath)) {
    next();
    return;
  }

  if (allowedGatewayHosts && !isAllowedGatewayHost(request.get("host"), allowedGatewayHosts)) {
    response.status(404).json({ error: "見つかりません。" });
    return;
  }

  const apiPath = gatewayPathsByRequest.get(`${request.method.toUpperCase()} ${rawPath}`);
  if (!apiPath) {
    response.status(404).json({ error: "見つかりません。" });
    return;
  }

  const rawQuery = queryIndex === -1 ? "" : requestUrl.slice(queryIndex);
  request.url = `${apiPath}${rawQuery}`;
  requireBearerAuth(request, response, next);
}
