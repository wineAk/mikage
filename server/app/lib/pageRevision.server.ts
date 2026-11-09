import { createHash } from "node:crypto";
import { parseCookieHeader } from "@supabase/ssr";
import { createClient } from "./supabase";

const clientsByRequest = new WeakMap<Request, ReturnType<typeof createClient>>();
const sessionCookiePattern = /^sb-.*-auth-token(?:-code-verifier)?(?:\.\d+)?$/;

export function isPageCacheEnabled(): boolean {
  return process.env.PAGE_CACHE_ENABLED === "true";
}

export function isPageCacheEligible(request: Request): boolean {
  if (request.headers.has("Authorization")) return false;
  try {
    return !parseCookieHeader(request.headers.get("Cookie") ?? "").some(cookie => sessionCookiePattern.test(cookie.name));
  } catch {
    return false;
  }
}

export function getPageCacheScope(request: Request): string | null {
  if (!isPageCacheEligible(request)) return null;
  // 認証値やCookieをキーへ直接保存せず、プロジェクトと利用者の境界を分ける。
  return createHash("sha256").update(JSON.stringify([
    process.env.VITE_SUPABASE_URL ?? "",
    process.env.VITE_SUPABASE_ANON_KEY ?? "",
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
  request.signal.throwIfAborted();
  try {
    let client = clientsByRequest.get(request);
    if (!client) {
      client = createClient(request, "mikage");
      clientsByRequest.set(request, client);
    }
    const { data, error } = await client.supabase.rpc("get_page_cache_revision").abortSignal(request.signal);
    request.signal.throwIfAborted();
    return !error && typeof data === "string" && data.length > 0 ? data : null;
  } catch {
    request.signal.throwIfAborted();
    return null;
  }
}
