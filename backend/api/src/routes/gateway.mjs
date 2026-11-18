import { requireBearerAuth } from "../middleware/auth.mjs";
import { gatewayRouteContracts } from "./gateway-contracts.mjs";

const gatewayPathsByRequest = new Map(
  gatewayRouteContracts.map(({ method, path, apiPath }) => [`${method} ${path}`, apiPath])
);

function isGatewayPath(rawPath) {
  if (rawPath.toLowerCase().startsWith("/gw")) return true;
  try {
    return decodeURIComponent(rawPath).toLowerCase().startsWith("/gw");
  } catch {
    return false;
  }
}

export function gatewayDispatchMiddleware(request, response, next) {
  const requestUrl = request.url ?? "/";
  const queryIndex = requestUrl.indexOf("?");
  const rawPath = queryIndex === -1 ? requestUrl : requestUrl.slice(0, queryIndex);
  if (!isGatewayPath(rawPath)) {
    next();
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
