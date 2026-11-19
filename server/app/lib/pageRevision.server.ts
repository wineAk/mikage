import { createHash } from "node:crypto";
import { fetchMikageApi, isMikageGatewayConfigured } from "./mikageApi.server";

const sessionCookiePattern = /^sb-.*-auth-token(?:-code-verifier)?(?:\.\d+)?$/;

export function isPageCacheEnabled(): boolean {
  return process.env.PAGE_CACHE_ENABLED === "true";
}

export function isPageCacheEligible(request: Request): boolean {
  if (request.headers.has("Authorization")) return false;
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const hasSessionCookie = cookieHeader.split(";").some((cookie) => {
    const separatorIndex = cookie.indexOf("=");
    const cookieName = (separatorIndex === -1 ? cookie : cookie.slice(0, separatorIndex)).trim();
    return sessionCookiePattern.test(cookieName);
  });
  return !hasSessionCookie;
}

export function getPageCacheScope(request: Request): string | null {
  if (!isPageCacheEligible(request)) return null;
  if (!isMikageGatewayConfigured()) return null;
  // 認証値やCookieをキーへ直接保存せず、プロジェクトと利用者の境界を分ける。
  return createHash("sha256").update(JSON.stringify([
    process.env.MIKAGE_GATEWAY_BASE_URL ?? "",
    process.env.MIKAGE_GATEWAY_ROUTE_PREFIX ?? "office/mikage",
    process.env.MIKAGE_API_BEARER_TOKEN ?? "",
    "mikage",
    "anonymous",
    request.headers.get("Cookie") ?? "",
    request.headers.get("Authorization") ?? "",
  ])).digest("hex");
}

// 呼出しごとにDBへ問い合わせる。取得前後の版確認を要求内でも共有しない。
export async function readPageRevision(request: Request): Promise<string | null> {
  if (!isPageCacheEnabled()) return null;
  if (!isPageCacheEligible(request)) return null;
  if (!isMikageGatewayConfigured()) return null;
  request.signal.throwIfAborted();
  try {
    const result = await fetchMikageApi<{ revision: string | null }>("view-revision", { signal: request.signal });
    request.signal.throwIfAborted();
    return typeof result.revision === "string" && result.revision.length > 0 ? result.revision : null;
  } catch {
    request.signal.throwIfAborted();
    return null;
  }
}
