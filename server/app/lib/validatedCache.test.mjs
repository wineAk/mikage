import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { createServer } from "node:http";
import { createValidatedCache } from "./validatedCache.ts";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "./supabase") return nextResolve("./supabase/index.ts", context);
  if (["./monthRange", "./validatedCache", "./pageRevision.server"].includes(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
const { getPageCacheScope, isPageCacheEligible, readPageRevision } = await import("./pageRevision.server.ts");
const { createPageHeaders, getPageCacheRevision, hasPageVersionConflict, readErrors, readLogs, readTargets, resetPageQueries } = await import("./pageQueries.server.ts");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

test("validates every hit against the authoritative version and clones saved results", async () => {
  const cache = createValidatedCache({ maxEntries: 2 });
  const source = { nested: { value: 1 } };
  let validations = 0;
  let loads = 0;
  const options = { key: "page", readVersion: async () => { validations++; return "1"; }, load: async () => { loads++; return source; } };
  const first = await cache.read(options);
  assert.equal(first.cache, "miss");
  first.value.nested.value = 100;
  source.nested.value = 200;
  const second = await cache.read(options);
  assert.equal(second.cache, "hit");
  assert.equal(second.value.nested.value, 1);
  second.value.nested.value = 300;
  assert.equal((await cache.read(options)).value.nested.value, 1);
  assert.equal(validations, 4);
  assert.equal(loads, 1);
});

test("reloads on changed versions instead of waiting for an expiration time", async () => {
  const cache = createValidatedCache({ maxEntries: 2 });
  let revision = "insert";
  let value = 1;
  const options = { key: "page", readVersion: async () => revision, load: async () => ({ value }) };
  await cache.read(options);
  for (const changed of ["update", "delete"]) {
    revision = changed;
    value++;
    const result = await cache.read(options);
    assert.equal(result.cache, "miss");
    assert.equal(result.version, changed);
    assert.equal(result.value.value, value);
  }
});

test("bypasses and discards cached data when validation is missing or fails", async () => {
  const cache = createValidatedCache({ maxEntries: 2 });
  let revision = "1";
  let loads = 0;
  const options = { key: "page", readVersion: async () => revision, load: async () => ++loads };
  await cache.read(options);
  revision = null;
  assert.deepEqual(await cache.read(options), { value: 2, cache: "bypass", version: null });
  assert.deepEqual(await cache.read({ ...options, readVersion: async () => { throw new Error("unavailable"); } }), { value: 3, cache: "bypass", version: null });
  revision = "1";
  assert.equal((await cache.read(options)).cache, "miss");
  assert.equal(loads, 4);
});

test("does not return old success when a fresh load fails, and can recover", async () => {
  const cache = createValidatedCache({ maxEntries: 2 });
  await cache.read({ key: "page", readVersion: async () => "1", load: async () => "old" });
  await assert.rejects(cache.read({ key: "page", readVersion: async () => "2", load: async () => { throw new Error("failed"); } }), /failed/);
  const recovered = await cache.read({ key: "page", readVersion: async () => "1", load: async () => "recovered" });
  assert.equal(recovered.cache, "miss");
  assert.equal(recovered.value, "recovered");
});

test("rechecks after a load and retries a concurrent mutation once", async () => {
  const cache = createValidatedCache({ maxEntries: 2 });
  let revision = "1";
  let loads = 0;
  const result = await cache.read({
    key: "page", readVersion: async () => revision,
    load: async () => { loads++; if (loads === 1) { revision = "2"; return "outdated"; } return "new"; },
  });
  assert.deepEqual(result, { value: "new", cache: "miss", version: "2" });
  assert.equal(loads, 2);
  assert.equal((await cache.read({ key: "page", readVersion: async () => "2", load: async () => "unused" })).value, "new");
});

test("returns an uncached fresh result when mutation continues during both loads", async () => {
  const cache = createValidatedCache({ maxEntries: 2 });
  let revision = 0;
  let loads = 0;
  const options = { key: "page", readVersion: async () => String(revision), load: async () => { loads++; revision++; return revision; } };
  assert.deepEqual(await cache.read(options), { value: 3, cache: "bypass", version: null });
  assert.equal(loads, 3);
  assert.deepEqual(await cache.read(options), { value: 6, cache: "bypass", version: null });
});

test("never publishes an unchecked value when validation fails after loading", async () => {
  const cache = createValidatedCache({ maxEntries: 2 });
  let validationCount = 0;
  const result = await cache.read({ key: "page", readVersion: async () => ++validationCount === 1 ? "1" : null, load: async () => "fresh" });
  assert.deepEqual(result, { value: "fresh", cache: "bypass", version: null });
  assert.equal((await cache.read({ key: "page", readVersion: async () => "1", load: async () => "reloaded" })).cache, "miss");
});

test("does not let a slow concurrent request publish a stale checked result", async () => {
  const cache = createValidatedCache({ maxEntries: 2 });
  let revision = "1";
  const slowLoad = deferred();
  const entered = deferred();
  let slowAttempts = 0;
  const slow = cache.read({ key: "page", readVersion: async () => revision, load: async () => { slowAttempts++; if (slowAttempts === 1) { entered.resolve(); return slowLoad.promise; } return "new"; } });
  await entered.promise;
  revision = "2";
  const fast = await cache.read({ key: "page", readVersion: async () => revision, load: async () => "new" });
  assert.equal(fast.value, "new");
  slowLoad.resolve("old");
  assert.equal((await slow).value, "new");
  assert.equal((await cache.read({ key: "page", readVersion: async () => revision, load: async () => "unused" })).value, "new");
});

test("evicts least recently used entries and enforces the serialized byte cap", async () => {
  const cache = createValidatedCache({ maxEntries: 2 });
  const read = key => cache.read({ key, readVersion: async () => "1", load: async () => key });
  await read("a"); await read("b"); await read("a"); await read("c");
  assert.equal((await read("a")).cache, "hit");
  assert.equal((await read("b")).cache, "miss");
  const bounded = createValidatedCache({ maxEntries: 100, maxBytes: 8 });
  const small = key => bounded.read({ key, readVersion: async () => "1", load: async () => "x" });
  await small("a"); await small("b");
  assert.equal((await small("a")).cache, "miss");
  const oversized = { key: "big", readVersion: async () => "1", load: async () => "x".repeat(100) };
  assert.equal((await bounded.read(oversized)).cache, "bypass");
  assert.equal((await bounded.read(oversized)).cache, "bypass");
});

test("aborts one caller promptly without cancelling another caller's independent load", async () => {
  const cache = createValidatedCache({ maxEntries: 2 });
  const controller = new AbortController();
  const entered = deferred();
  const hanging = deferred();
  const cancelled = cache.read({ key: "page", signal: controller.signal, readVersion: async () => "1", load: async () => { entered.resolve(); return hanging.promise; } });
  await entered.promise;
  const other = cache.read({ key: "page", readVersion: async () => "1", load: async () => "other" });
  assert.equal((await other).value, "other");
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  hanging.resolve("cancelled");
  await Promise.resolve();
  assert.equal((await cache.read({ key: "page", readVersion: async () => "1", load: async () => "fresh" })).value, "other");
});

test("rejects already aborted requests and invalid bounds, and supports explicit clear", async () => {
  const cache = createValidatedCache({ maxEntries: 1 });
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(cache.read({ key: "page", signal: controller.signal, readVersion: async () => { called = true; return "1"; }, load: async () => "unused" }), { name: "AbortError" });
  assert.equal(called, false);
  const options = { key: "page", readVersion: async () => "1", load: async () => "fresh" };
  await cache.read(options); cache.clear();
  assert.equal((await cache.read(options)).cache, "miss");
  assert.throws(() => createValidatedCache({ maxEntries: -1 }), RangeError);
  assert.throws(() => createValidatedCache({ maxEntries: 1, maxBytes: Number.NaN }), RangeError);
  assert.equal((await createValidatedCache({ maxEntries: 0 }).read(options)).cache, "bypass");
});

test("allows anonymous analytics cookies but bypasses every recognized auth context", async () => {
  assert.equal(isPageCacheEligible(new Request("https://example.test", { headers: { Cookie: "_ga=visitor; cf_clearance=opaque" } })), true);
  for (const name of ["sb-example-auth-token", "sb-example-auth-token.0", "sb-example-auth-token.12", "sb-example-auth-token-code-verifier", "sb-example-auth-token-code-verifier.0"]) {
    const request = new Request("https://example.test", { headers: { Cookie: `${name}=session` } });
    assert.equal(isPageCacheEligible(request), false);
    assert.equal(getPageCacheScope(request), null);
    assert.equal(await readPageRevision(request), null);
  }
  const authorized = new Request("https://example.test", { headers: { Authorization: "Bearer example" } });
  assert.equal(isPageCacheEligible(authorized), false);
  assert.equal(await readPageRevision(authorized), null);
});

test("hashes the complete cookie and project context without retaining raw values", () => {
  const previousProject = process.env.VITE_SUPABASE_URL;
  const previousKey = process.env.VITE_SUPABASE_ANON_KEY;
  try {
    process.env.VITE_SUPABASE_URL = "https://project-one.example.test";
    process.env.VITE_SUPABASE_ANON_KEY = "example-key";
    const first = new Request("https://example.test", { headers: { Cookie: "_ga=some-private-value; preference=one" } });
    const second = new Request("https://example.test", { headers: { Cookie: "_ga=some-private-value; preference=two" } });
    const scope = getPageCacheScope(first);
    assert.match(scope, /^[a-f0-9]{64}$/);
    assert.notEqual(scope, getPageCacheScope(second));
    process.env.VITE_SUPABASE_URL = "https://project-two.example.test";
    assert.notEqual(scope, getPageCacheScope(first));
    assert.equal(scope.includes("some-private-value"), false);
  } finally {
    if (previousProject === undefined) delete process.env.VITE_SUPABASE_URL;
    else process.env.VITE_SUPABASE_URL = previousProject;
    if (previousKey === undefined) delete process.env.VITE_SUPABASE_ANON_KEY;
    else process.env.VITE_SUPABASE_ANON_KEY = previousKey;
  }
});

async function withDatabaseFixture(execute) {
  const previousProject = process.env.VITE_SUPABASE_URL;
  const previousKey = process.env.VITE_SUPABASE_ANON_KEY;
  const previousCacheEnabled = process.env.PAGE_CACHE_ENABLED;
  const state = { revision: "1", targetName: "before", revisionAvailable: true, flipOnErrors: false, requests: [] };
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    let body = "";
    for await (const chunk of request) body += chunk;
    state.requests.push({ path, parameters: body ? JSON.parse(body) : null });
    response.setHeader("Content-Type", "application/json");
    if (path.endsWith("/get_page_cache_revision")) {
      if (!state.revisionAvailable) { response.writeHead(404); response.end(JSON.stringify({ code: "PGRST202", message: "missing" })); return; }
      response.end(JSON.stringify(state.revision));
    } else if (path.endsWith("/targets")) {
      response.end(JSON.stringify([{ key: "example", name: state.targetName }]));
    } else if (path.endsWith("/get_error_logs")) {
      state.onErrors?.();
      if (state.flipOnErrors) { state.flipOnErrors = false; state.revision = "2"; state.targetName = "after-change"; }
      response.end(JSON.stringify({ logs: [], previous_month_count: 0, next_month_count: 0 }));
    } else if (path.endsWith("/get_logs_in_range")) {
      response.end(JSON.stringify([{ key: "example", name: state.targetName, logs: [] }]));
    } else { response.writeHead(404); response.end(JSON.stringify({ code: "missing" })); }
  });
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    process.env.VITE_SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.VITE_SUPABASE_ANON_KEY = "example-anon-key";
    process.env.PAGE_CACHE_ENABLED = "true";
    await execute(state);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (previousProject === undefined) delete process.env.VITE_SUPABASE_URL;
    else process.env.VITE_SUPABASE_URL = previousProject;
    if (previousKey === undefined) delete process.env.VITE_SUPABASE_ANON_KEY;
    else process.env.VITE_SUPABASE_ANON_KEY = previousKey;
    if (previousCacheEnabled === undefined) delete process.env.PAGE_CACHE_ENABLED;
    else process.env.PAGE_CACHE_ENABLED = previousCacheEnabled;
  }
}

test("disabled page cache reads fresh data without metadata RPC requests", async () => {
  await withDatabaseFixture(async state => {
    process.env.PAGE_CACHE_ENABLED = "false";
    const { readTargets } = await import("./pageQueries.server.ts");
    assert.equal((await readTargets(new Request("https://example.test/")))[0].name, "before");
    state.targetName = "latest";
    assert.equal((await readTargets(new Request("https://example.test/")))[0].name, "latest");
    assert.equal(state.requests.filter(item => item.path.endsWith("/get_page_cache_revision")).length, 0);
    assert.equal(state.requests.filter(item => item.path.endsWith("/targets")).length, 2);
  });
});

test("request integration validates hits, fails fresh when revision RPC is missing, and bypasses session cookies", async () => {
  await withDatabaseFixture(async state => {
    const request = () => new Request("https://example.test/");
    const first = request();
    assert.equal((await readTargets(first))[0].name, "before");
    assert.equal(getPageCacheRevision(first), "1");
    assert.equal(state.requests.filter(item => item.path.endsWith("/get_page_cache_revision")).length, 2);
    assert.match(createPageHeaders(first).get("Server-Timing"), /page_cache_miss;desc="1"/);
    const second = request();
    await readTargets(second);
    assert.equal(state.requests.filter(item => item.path.endsWith("/targets")).length, 1);
    assert.equal(state.requests.filter(item => item.path.endsWith("/get_page_cache_revision")).length, 3);
    assert.match(createPageHeaders(second).get("Server-Timing"), /page_cache_hit;desc="1"/);
    assert.match(createPageHeaders(second).get("Cache-Control"), /private, no-store/);
    state.revisionAvailable = false;
    state.targetName = "latest";
    const missing = request();
    assert.equal((await readTargets(missing))[0].name, "latest");
    assert.equal(getPageCacheRevision(missing), null);
    assert.equal(hasPageVersionConflict(missing), false);
    const revisionReads = state.requests.filter(item => item.path.endsWith("/get_page_cache_revision")).length;
    const session = new Request("https://example.test/", { headers: { Cookie: "sb-example-auth-token.0=example" } });
    assert.equal((await readTargets(session))[0].name, "latest");
    assert.equal(getPageCacheRevision(session), null);
    assert.equal(state.requests.filter(item => item.path.endsWith("/get_page_cache_revision")).length, revisionReads);
  });
});

test("request integration detects mixed query versions and resets whole-loader validation", async () => {
  await withDatabaseFixture(async state => {
    state.flipOnErrors = true;
    const request = new Request("https://example.test/incidents");
    await Promise.all([readTargets(request), readErrors(request, 0)]);
    assert.equal(hasPageVersionConflict(request), true);
    assert.equal(getPageCacheRevision(request), null);
    resetPageQueries(request);
    assert.equal(hasPageVersionConflict(request), false);
    await Promise.all([readTargets(request), readErrors(request, 0)]);
    assert.equal(getPageCacheRevision(request), "2");
    assert.equal(hasPageVersionConflict(request), false);
    assert.equal((await readTargets(request))[0].name, "after-change");
  });
});

test("request integration never reuses rolling logs across different exact time windows", async () => {
  await withDatabaseFixture(async state => {
    const first = new Request("https://example.test/");
    await readLogs(first, ["example"], 60, new Date("2026-11-01T10:00:00.000Z"));
    const second = new Request("https://example.test/");
    await readLogs(second, ["example"], 60, new Date("2026-11-01T10:00:00.001Z"));
    assert.equal(state.requests.filter(item => item.path.endsWith("/get_logs_in_range")).length, 2);
    assert.equal(getPageCacheRevision(first), "1");
    assert.equal(getPageCacheRevision(second), "1");
  });
});

test("does not store relative-month RPC data under the previous month's cache key", async () => {
  const NativeDate = Date;
  let currentTime = "2026-11-30T14:59:59.999Z";
  globalThis.Date = class extends NativeDate {
    constructor(...arguments_) { super(...(arguments_.length ? arguments_ : [currentTime])); }
    static now() { return NativeDate.parse(currentTime); }
  };
  try {
    await withDatabaseFixture(async state => {
      state.onErrors = () => { currentTime = "2026-11-30T15:00:00.000Z"; };
      const request = new Request("https://example.test/errors");
      await assert.rejects(readErrors(request, 0), { name: "PageSnapshotConflictError" });
      assert.equal(getPageCacheRevision(request), null);
      assert.equal(hasPageVersionConflict(request), true);
      state.onErrors = undefined;
      resetPageQueries(request);
      await readErrors(request, 0);
      assert.equal(hasPageVersionConflict(request), false);
      assert.equal(getPageCacheRevision(request), "1");
    });
  } finally { globalThis.Date = NativeDate; }
});
