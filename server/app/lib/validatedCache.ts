type CacheEntry = {
  version: string;
  value: unknown;
  bytes: number;
};

export type ValidatedCacheResult<T> = {
  value: T;
  cache: "hit" | "miss" | "bypass";
  version: string | null;
};

type ReadOptions<T> = {
  key: string;
  readVersion: () => Promise<string | null>;
  load: () => Promise<T>;
  signal?: AbortSignal;
};

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const textEncoder = new TextEncoder();

function throwIfAborted(signal?: AbortSignal) {
  signal?.throwIfAborted();
}

// 呼出元だけを中断する。別要求の処理やAbortControllerは共有しない。
async function runWithAbort<T>(execute: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return execute();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      throwIfAborted(signal);
      return execute();
    }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

// 上限はキー・版番号・JSON表現のUTF8長を基準とする。
// JSONで安全に表せない値は保存せず、取得結果だけを返す。
function estimateBytes(key: string, version: string, value: unknown): number | null {
  try {
    const json = JSON.stringify(value, (_name, item: unknown) => {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const prototype = Object.getPrototypeOf(item);
        if (prototype !== Object.prototype && prototype !== null) throw new Error("JSON形式ではありません。");
      }
      return item;
    });
    return textEncoder.encode(key).byteLength + textEncoder.encode(version).byteLength + textEncoder.encode(json ?? "null").byteLength;
  } catch {
    return null;
  }
}

export function createValidatedCache({ maxEntries, maxBytes = DEFAULT_MAX_BYTES }: { maxEntries: number; maxBytes?: number }) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 0) throw new RangeError("キャッシュ件数の上限が不正です。");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("キャッシュ容量の上限が不正です。");
  const entries = new Map<string, CacheEntry>();
  let totalBytes = 0;

  function remove(key: string) {
    const existing = entries.get(key);
    if (!existing) return;
    totalBytes -= existing.bytes;
    entries.delete(key);
  }

  function clear() {
    entries.clear();
    totalBytes = 0;
  }

  function store<T>(key: string, version: string, value: T): boolean {
    const snapshot = structuredClone(value);
    const bytes = estimateBytes(key, version, snapshot);
    remove(key);
    if (maxEntries === 0 || bytes === null || bytes > maxBytes) return false;
    entries.set(key, { version, value: snapshot, bytes });
    totalBytes += bytes;
    while (entries.size > maxEntries || totalBytes > maxBytes) remove(entries.keys().next().value!);
    return entries.has(key);
  }

  async function read<T>({ key, readVersion, load, signal }: ReadOptions<T>): Promise<ValidatedCacheResult<T>> {
    async function getVersion(): Promise<string | null> {
      try {
        const version = await runWithAbort(readVersion, signal);
        throwIfAborted(signal);
        return typeof version === "string" && version.length > 0 ? version : null;
      } catch {
        throwIfAborted(signal);
        return null;
      }
    }

    async function fresh(): Promise<T> {
      const value = await runWithAbort(load, signal);
      throwIfAborted(signal);
      return value;
    }

    try {
      let version = await getVersion();
      if (version === null) {
        remove(key);
        return { value: structuredClone(await fresh()), cache: "bypass", version: null };
      }

      const cached = entries.get(key);
      if (cached?.version === version) {
        // 検証が終わった結果だけを再利用し、呼出元の変更を保存値へ伝播させない。
        const value = structuredClone(cached.value) as T;
        throwIfAborted(signal);
        entries.delete(key);
        entries.set(key, cached);
        return { value, cache: "hit", version };
      }
      remove(key);

      for (let attempt = 0; attempt < 2; attempt++) {
        const value = await fresh();
        const currentVersion = await getVersion();
        if (currentVersion === null) {
          remove(key);
          return { value: structuredClone(value), cache: "bypass", version: null };
        }
        if (currentVersion === version) {
          const isStored = store(key, currentVersion, value);
          return { value: structuredClone(value), cache: isStored ? "miss" : "bypass", version: isStored ? currentVersion : null };
        }
        remove(key);
        version = currentVersion;
      }

      // 更新が続くときは版確認を無限に繰り返さず、新規取得して保存しない。
      return { value: structuredClone(await fresh()), cache: "bypass", version: null };
    } catch (error) {
      // 中断した要求が、別要求の保存済み結果を消すことも避ける。
      if (!signal?.aborted) remove(key);
      throw error;
    }
  }

  return { read, clear };
}
