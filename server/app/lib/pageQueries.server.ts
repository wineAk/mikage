import type { Error as ErrorPageData, Incident, Key, Target } from "@/types/api";
import { fetchMikageApi } from "./mikageApi.server";
import { getJstMonthRange } from "./monthRange";
import { createValidatedCache } from "./validatedCache";
import type { ValidatedCacheResult } from "./validatedCache";
import { getPageCacheScope, isPageCacheEnabled, readPageRevision } from "./pageRevision.server";

type RequestQueries = {
  pending: Map<string, Promise<unknown>>;
  timings: Array<{ name: string; duration: number }>;
  cacheScope: string | null;
  initialVersion?: Promise<string | null>;
  versions: Set<string>;
  hasUnvalidatedResult: boolean;
  hasSnapshotConflict: boolean;
  generation: number;
  cacheOutcomes: { hit: number; miss: number; bypass: number };
};

// 同じHTTP要求内だけで接続設定と重複クエリを共有する。
// 別の要求の結果を使う場合も、利用者の境界を分けてDBの版を毎回確認する。
const queriesByRequest = new WeakMap<Request, RequestQueries>();
const resultCache = createValidatedCache({ maxEntries: 64, maxBytes: 8 * 1024 * 1024 });

export class PageSnapshotConflictError extends Error {
  constructor() {
    super("データ取得中に表示対象の月が変わりました。");
    this.name = "PageSnapshotConflictError";
  }
}

function getRequestQueries(request: Request): RequestQueries {
  let queries = queriesByRequest.get(request);
  if (!queries) {
    queries = {
      pending: new Map(), timings: [],
      cacheScope: isPageCacheEnabled() ? getPageCacheScope(request) : null, versions: new Set(), hasUnvalidatedResult: false, hasSnapshotConflict: false,
      generation: 0, cacheOutcomes: { hit: 0, miss: 0, bypass: 0 },
    };
    queriesByRequest.set(request, queries);
  }
  return queries;
}

function observeVersion(queries: RequestQueries, generation: number, version: string | null) {
  if (queries.generation !== generation) return;
  if (version === null) queries.hasUnvalidatedResult = true;
  else queries.versions.add(version);
}

function runQuery<T>(request: Request, name: string, key: string, execute: (queries: RequestQueries) => Promise<T>): Promise<T> {
  const queries = getRequestQueries(request);
  const existing = queries.pending.get(key);
  if (existing) return existing as Promise<T>;
  const startedAt = performance.now();
  const generation = queries.generation;
  const pending = (async () => {
    let result: ValidatedCacheResult<T>;
    if (queries.cacheScope === null) {
      result = { value: await execute(queries), cache: "bypass", version: null };
    } else {
      let hasReadBefore = false;
      const readVersion = async () => {
        if (!hasReadBefore) {
          hasReadBefore = true;
          if (!queries.initialVersion) {
            queries.initialVersion = readPageRevision(request).then(version => {
              observeVersion(queries, generation, version);
              return version;
            });
          }
          return queries.initialVersion;
        }
        const version = await readPageRevision(request);
        observeVersion(queries, generation, version);
        return version;
      };
      result = await resultCache.read<T>({
        key: JSON.stringify([queries.cacheScope, key]), readVersion,
        load: () => execute(queries), signal: request.signal,
      });
    }
    if (queries.generation === generation) {
      queries.cacheOutcomes[result.cache]++;
      observeVersion(queries, generation, result.version);
    }
    return result.value;
  })().catch((error: unknown) => {
    if (queries.generation === generation) {
      queries.hasUnvalidatedResult = true;
      if (error instanceof PageSnapshotConflictError) queries.hasSnapshotConflict = true;
    }
    throw error;
  }).finally(() => {
    queries.timings.push({ name, duration: performance.now() - startedAt });
  });
  queries.pending.set(key, pending);
  return pending;
}

export function hasPageVersionConflict(request: Request): boolean {
  const queries = queriesByRequest.get(request);
  return queries?.hasSnapshotConflict === true || (queries?.versions.size ?? 0) > 1;
}

export function getPageCacheRevision(request: Request): string | null {
  const queries = queriesByRequest.get(request);
  if (!queries || queries.hasUnvalidatedResult || queries.hasSnapshotConflict || queries.versions.size !== 1) return null;
  return queries.versions.values().next().value ?? null;
}

export function resetPageQueries(request: Request): void {
  const queries = queriesByRequest.get(request);
  if (!queries) return;
  queries.generation++;
  queries.pending.clear();
  queries.initialVersion = undefined;
  queries.versions.clear();
  queries.hasUnvalidatedResult = false;
  queries.hasSnapshotConflict = false;
}

export function createPageHeaders(request?: Request): Headers {
  const queries = request ? queriesByRequest.get(request) : undefined;
  const headers = new Headers();
  headers.set("Cache-Control", "private, no-store");
  headers.set("Vary", "Cookie");
  if (queries) {
    const timings = queries.timings.map(item => `${item.name};dur=${item.duration.toFixed(1)}`);
    for (const outcome of ["hit", "miss", "bypass"] as const) timings.push(`page_cache_${outcome};desc="${queries.cacheOutcomes[outcome]}"`);
    headers.set("Server-Timing", timings.join(", "));
  }
  return headers;
}

export function readTargets(request: Request): Promise<Target[]> {
  return runQuery(request, "mikage_targets", "targets", async () => {
    const result = await fetchMikageApi<{ targets: Target[] }>("view-targets", { signal: request.signal });
    if (!Array.isArray(result.targets)) throw new Error("監視対象の取得に失敗しました。");
    return result.targets;
  });
}

export function readLogs(request: Request, keys: string[], minute: number, now: Date): Promise<Key[]> {
  const end = now.toISOString();
  const start = new Date(now.getTime() - minute * 60_000).toISOString();
  return runQuery(request, "mikage_logs", JSON.stringify(["logs", keys, start, end]), async () => {
    if (keys.length === 0) return [];
    const query = new URLSearchParams({ keys: keys.join(","), start, end });
    const result = await fetchMikageApi<{ data: Key[] }>("view-logs", { query, signal: request.signal });
    if (!Array.isArray(result.data)) throw new Error("監視ログの取得に失敗しました。");
    return result.data;
  });
}

export function readErrors(request: Request, offset: number): Promise<ErrorPageData> {
  const { start, end } = getJstMonthRange(offset);
  return runQuery(request, "mikage_errors", JSON.stringify(["errors", offset, start, end]), async () => {
    const result = await fetchMikageApi<{ data: ErrorPageData }>("view-errors", { query: new URLSearchParams({ offset: String(offset) }), signal: request.signal });
    if (!result.data || !Array.isArray(result.data.logs)) throw new Error("エラー情報の取得に失敗しました。");
    if (getJstMonthRange(offset).start !== start) throw new PageSnapshotConflictError();
    return result.data;
  });
}

export function readIncidents(request: Request, offset: number): Promise<Incident[]> {
  const { start, end } = getJstMonthRange(offset);
  return runQuery(request, "mikage_incidents", JSON.stringify(["incidents", offset, start, end]), async () => {
    const result = await fetchMikageApi<{ data: Incident[] }>("view-incidents", { query: new URLSearchParams({ offset: String(offset) }), signal: request.signal });
    if (!Array.isArray(result.data)) throw new Error("インシデントの取得に失敗しました。");
    return result.data;
  });
}
