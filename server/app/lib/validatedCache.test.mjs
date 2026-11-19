import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { createServer } from "node:http";
import { createValidatedCache } from "./validatedCache.ts";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (["./monthRange", "./validatedCache", "./pageRevision.server", "./mikageApi.server"].includes(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
const { getPageCacheScope, isPageCacheEligible, readPageRevision } = await import("./pageRevision.server.ts");
const { createPageHeaders, getPageCacheRevision, hasPageVersionConflict, readErrors, readLogs, readTargets, resetPageQueries } = await import("./pageQueries.server.ts");
const { fetchMikageApi } = await import("./mikageApi.server.ts");

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
  const previousGateway = process.env.MIKAGE_GATEWAY_BASE_URL;
  const previousRoutePrefix = process.env.MIKAGE_GATEWAY_ROUTE_PREFIX;
  const previousToken = process.env.MIKAGE_API_BEARER_TOKEN;
  try {
    process.env.MIKAGE_GATEWAY_BASE_URL = "https://gateway-one.example.test";
    process.env.MIKAGE_API_BEARER_TOKEN = "example-key";
    const first = new Request("https://example.test", { headers: { Cookie: "_ga=some-private-value; preference=one" } });
    const second = new Request("https://example.test", { headers: { Cookie: "_ga=some-private-value; preference=two" } });
    const scope = getPageCacheScope(first);
    assert.match(scope, /^[a-f0-9]{64}$/);
    assert.notEqual(scope, getPageCacheScope(second));
    process.env.MIKAGE_GATEWAY_BASE_URL = "https://gateway-two.example.test";
    assert.notEqual(scope, getPageCacheScope(first));
    process.env.MIKAGE_GATEWAY_BASE_URL = "https://gateway-one.example.test";
    process.env.MIKAGE_GATEWAY_ROUTE_PREFIX = "office/mikage-staging";
    assert.notEqual(scope, getPageCacheScope(first));
    assert.equal(scope.includes("some-private-value"), false);
  } finally {
    if (previousGateway === undefined) delete process.env.MIKAGE_GATEWAY_BASE_URL;
    else process.env.MIKAGE_GATEWAY_BASE_URL = previousGateway;
    if (previousRoutePrefix === undefined) delete process.env.MIKAGE_GATEWAY_ROUTE_PREFIX;
    else process.env.MIKAGE_GATEWAY_ROUTE_PREFIX = previousRoutePrefix;
    if (previousToken === undefined) delete process.env.MIKAGE_API_BEARER_TOKEN;
    else process.env.MIKAGE_API_BEARER_TOKEN = previousToken;
  }
});

test("Gateway base URLはorigin rootに限定し、重複prefixを拒否する", async () => {
  const previousGateway = process.env.MIKAGE_GATEWAY_BASE_URL;
  const previousToken = process.env.MIKAGE_API_BEARER_TOKEN;
  const previousRoutePrefix = process.env.MIKAGE_GATEWAY_ROUTE_PREFIX;
  try {
    process.env.MIKAGE_GATEWAY_BASE_URL = "https://gateway.example.test/office/mikage";
    process.env.MIKAGE_API_BEARER_TOKEN = "example-api-token";
    await assert.rejects(fetchMikageApi("view-targets"), /Gatewayの設定が不正です/);
  } finally {
    if (previousGateway === undefined) delete process.env.MIKAGE_GATEWAY_BASE_URL;
    else process.env.MIKAGE_GATEWAY_BASE_URL = previousGateway;
    if (previousToken === undefined) delete process.env.MIKAGE_API_BEARER_TOKEN;
    else process.env.MIKAGE_API_BEARER_TOKEN = previousToken;
    if (previousRoutePrefix === undefined) delete process.env.MIKAGE_GATEWAY_ROUTE_PREFIX;
    else process.env.MIKAGE_GATEWAY_ROUTE_PREFIX = previousRoutePrefix;
  }
});

test("Gateway route prefixはStaging namespaceだけを追加許可する", async () => {
  const previousGateway = process.env.MIKAGE_GATEWAY_BASE_URL;
  const previousToken = process.env.MIKAGE_API_BEARER_TOKEN;
  const previousRoutePrefix = process.env.MIKAGE_GATEWAY_ROUTE_PREFIX;
  const previousIsPullRequest = process.env.IS_PULL_REQUEST;
  try {
    process.env.MIKAGE_GATEWAY_BASE_URL = "https://gateway.example.test";
    process.env.MIKAGE_API_BEARER_TOKEN = "example-api-token";
    process.env.MIKAGE_GATEWAY_ROUTE_PREFIX = "../../v1/admin";
    await assert.rejects(fetchMikageApi("view-targets"), /Gatewayの設定が不正です/);
    process.env.MIKAGE_GATEWAY_ROUTE_PREFIX = "office/mikage-staging";
    process.env.IS_PULL_REQUEST = "false";
    await assert.rejects(fetchMikageApi("view-targets"), /Gatewayの設定が不正です/);
  } finally {
    if (previousGateway === undefined) delete process.env.MIKAGE_GATEWAY_BASE_URL;
    else process.env.MIKAGE_GATEWAY_BASE_URL = previousGateway;
    if (previousToken === undefined) delete process.env.MIKAGE_API_BEARER_TOKEN;
    else process.env.MIKAGE_API_BEARER_TOKEN = previousToken;
    if (previousRoutePrefix === undefined) delete process.env.MIKAGE_GATEWAY_ROUTE_PREFIX;
    else process.env.MIKAGE_GATEWAY_ROUTE_PREFIX = previousRoutePrefix;
    if (previousIsPullRequest === undefined) delete process.env.IS_PULL_REQUEST;
    else process.env.IS_PULL_REQUEST = previousIsPullRequest;
  }
});

async function withGatewayFixture(execute) {
  const previousGateway = process.env.MIKAGE_GATEWAY_BASE_URL;
  const previousToken = process.env.MIKAGE_API_BEARER_TOKEN;
  const previousRoutePrefix = process.env.MIKAGE_GATEWAY_ROUTE_PREFIX;
  const previousIsPullRequest = process.env.IS_PULL_REQUEST;
  const previousCacheEnabled = process.env.PAGE_CACHE_ENABLED;
  const previousFetch = globalThis.fetch;
  const gatewayOrigin = "https://gateway.example.test";
  const apiToken = "example-api-token";
  const state = { revision: "1", targetName: "before", revisionAvailable: true, flipOnErrors: false, requests: [] };
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url, "http://127.0.0.1");
    const path = requestUrl.pathname;
    state.requests.push({ path, query: requestUrl.searchParams, authorization: request.headers.authorization });
    response.setHeader("Content-Type", "application/json");
    if (request.headers.authorization !== `Bearer ${apiToken}`) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Unauthorized" }));
    } else if (path.endsWith("/view-revision")) {
      if (!state.revisionAvailable) { response.writeHead(503); response.end(JSON.stringify({ error: "unavailable" })); return; }
      response.end(JSON.stringify({ revision: state.revision }));
    } else if (path.endsWith("/view-targets")) {
      response.end(JSON.stringify({ targets: [{ key: "example", name: state.targetName }] }));
    } else if (path.endsWith("/view-errors")) {
      state.onErrors?.();
      if (state.flipOnErrors) { state.flipOnErrors = false; state.revision = "2"; state.targetName = "after-change"; }
      response.end(JSON.stringify({ data: { logs: [], previous_month_count: 0, next_month_count: 0 } }));
    } else if (path.endsWith("/view-logs")) {
      response.end(JSON.stringify({ data: [{ key: "example", name: state.targetName, logs: [] }] }));
    } else if (path.endsWith("/view-incidents")) {
      response.end(JSON.stringify({ data: [] }));
    } else if (path.endsWith("/watch-results") && request.method === "POST") {
      response.end(JSON.stringify({ saved: true }));
    } else { response.writeHead(404); response.end(JSON.stringify({ code: "missing" })); }
  });
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    process.env.MIKAGE_GATEWAY_BASE_URL = gatewayOrigin;
    process.env.MIKAGE_API_BEARER_TOKEN = apiToken;
    delete process.env.MIKAGE_GATEWAY_ROUTE_PREFIX;
    delete process.env.IS_PULL_REQUEST;
    process.env.PAGE_CACHE_ENABLED = "true";
    globalThis.fetch = (input, init) => {
      const requestUrl = new URL(input);
      if (requestUrl.origin !== gatewayOrigin) return previousFetch(input, init);
      const localUrl = `http://127.0.0.1:${server.address().port}${requestUrl.pathname}${requestUrl.search}`;
      return previousFetch(localUrl, init);
    };
    await execute(state);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    globalThis.fetch = previousFetch;
    if (previousGateway === undefined) delete process.env.MIKAGE_GATEWAY_BASE_URL;
    else process.env.MIKAGE_GATEWAY_BASE_URL = previousGateway;
    if (previousToken === undefined) delete process.env.MIKAGE_API_BEARER_TOKEN;
    else process.env.MIKAGE_API_BEARER_TOKEN = previousToken;
    if (previousRoutePrefix === undefined) delete process.env.MIKAGE_GATEWAY_ROUTE_PREFIX;
    else process.env.MIKAGE_GATEWAY_ROUTE_PREFIX = previousRoutePrefix;
    if (previousIsPullRequest === undefined) delete process.env.IS_PULL_REQUEST;
    else process.env.IS_PULL_REQUEST = previousIsPullRequest;
    if (previousCacheEnabled === undefined) delete process.env.PAGE_CACHE_ENABLED;
    else process.env.PAGE_CACHE_ENABLED = previousCacheEnabled;
  }
}

test("Staging route prefixを使って同じGateway hostから隔離namespaceへ送る", async () => {
  await withGatewayFixture(async (state) => {
    process.env.MIKAGE_GATEWAY_ROUTE_PREFIX = "office/mikage-staging";
    process.env.IS_PULL_REQUEST = "true";
    await fetchMikageApi("view-targets", { query: new URLSearchParams({ source: "preview" }) });
    assert.equal(state.requests[0].path, "/office/mikage-staging/view-targets");
    assert.equal(state.requests[0].query.get("source"), "preview");
    assert.equal(state.requests[0].authorization, "Bearer example-api-token");
  });
});

test("PR Previewはroute prefix未設定でfail closedし、fetchを呼ばない", async () => {
  const previousGateway = process.env.MIKAGE_GATEWAY_BASE_URL;
  const previousToken = process.env.MIKAGE_API_BEARER_TOKEN;
  const previousRoutePrefix = process.env.MIKAGE_GATEWAY_ROUTE_PREFIX;
  const previousIsPullRequest = process.env.IS_PULL_REQUEST;
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  try {
    process.env.MIKAGE_GATEWAY_BASE_URL = "https://gateway.example.test";
    process.env.MIKAGE_API_BEARER_TOKEN = "example-api-token";
    process.env.IS_PULL_REQUEST = "true";
    delete process.env.MIKAGE_GATEWAY_ROUTE_PREFIX;
    globalThis.fetch = (...arguments_) => {
      fetchCalls++;
      return previousFetch(...arguments_);
    };
    await assert.rejects(fetchMikageApi("view-targets"), /Gatewayの設定が不正です/);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousGateway === undefined) delete process.env.MIKAGE_GATEWAY_BASE_URL;
    else process.env.MIKAGE_GATEWAY_BASE_URL = previousGateway;
    if (previousToken === undefined) delete process.env.MIKAGE_API_BEARER_TOKEN;
    else process.env.MIKAGE_API_BEARER_TOKEN = previousToken;
    if (previousRoutePrefix === undefined) delete process.env.MIKAGE_GATEWAY_ROUTE_PREFIX;
    else process.env.MIKAGE_GATEWAY_ROUTE_PREFIX = previousRoutePrefix;
    if (previousIsPullRequest === undefined) delete process.env.IS_PULL_REQUEST;
    else process.env.IS_PULL_REQUEST = previousIsPullRequest;
  }
});

test("PR PreviewはProduction route prefixを拒否し、fetchを呼ばない", async () => {
  const previousGateway = process.env.MIKAGE_GATEWAY_BASE_URL;
  const previousToken = process.env.MIKAGE_API_BEARER_TOKEN;
  const previousRoutePrefix = process.env.MIKAGE_GATEWAY_ROUTE_PREFIX;
  const previousIsPullRequest = process.env.IS_PULL_REQUEST;
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  try {
    process.env.MIKAGE_GATEWAY_BASE_URL = "https://gateway.example.test";
    process.env.MIKAGE_API_BEARER_TOKEN = "example-api-token";
    process.env.IS_PULL_REQUEST = "true";
    process.env.MIKAGE_GATEWAY_ROUTE_PREFIX = "office/mikage";
    globalThis.fetch = (...arguments_) => {
      fetchCalls++;
      return previousFetch(...arguments_);
    };
    await assert.rejects(fetchMikageApi("view-targets"), /Gatewayの設定が不正です/);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousGateway === undefined) delete process.env.MIKAGE_GATEWAY_BASE_URL;
    else process.env.MIKAGE_GATEWAY_BASE_URL = previousGateway;
    if (previousToken === undefined) delete process.env.MIKAGE_API_BEARER_TOKEN;
    else process.env.MIKAGE_API_BEARER_TOKEN = previousToken;
    if (previousRoutePrefix === undefined) delete process.env.MIKAGE_GATEWAY_ROUTE_PREFIX;
    else process.env.MIKAGE_GATEWAY_ROUTE_PREFIX = previousRoutePrefix;
    if (previousIsPullRequest === undefined) delete process.env.IS_PULL_REQUEST;
    else process.env.IS_PULL_REQUEST = previousIsPullRequest;
  }
});

test("PR PreviewのStaging prefixはwatch POSTも同一namespaceへ送る", async () => {
  await withGatewayFixture(async (state) => {
    process.env.MIKAGE_GATEWAY_ROUTE_PREFIX = "office/mikage-staging";
    process.env.IS_PULL_REQUEST = "true";
    const result = await fetchMikageApi("watch-results", {
      method: "POST",
      body: { results: [{ key: "example", status: "ok" }] },
    });
    assert.equal(result.saved, true);
    assert.equal(state.requests.at(-1).path, "/office/mikage-staging/watch-results");
    assert.equal(state.requests.at(-1).authorization, "Bearer example-api-token");
  });
});

test("disabled page cache reads fresh data without revision API requests", async () => {
  await withGatewayFixture(async state => {
    process.env.PAGE_CACHE_ENABLED = "false";
    const { readTargets } = await import("./pageQueries.server.ts");
    assert.equal((await readTargets(new Request("https://example.test/")))[0].name, "before");
    state.targetName = "latest";
    assert.equal((await readTargets(new Request("https://example.test/")))[0].name, "latest");
    assert.equal(state.requests.filter(item => item.path.endsWith("/view-revision")).length, 0);
    assert.equal(state.requests.filter(item => item.path.endsWith("/view-targets")).length, 2);
  });
});

test("request integration validates cache hits, fails fresh when revision API is missing, and bypasses session cookies", async () => {
  await withGatewayFixture(async state => {
    const request = () => new Request("https://example.test/");
    const first = request();
    assert.equal((await readTargets(first))[0].name, "before");
    assert.equal(state.requests[0].path, "/office/mikage/view-revision");
    assert.equal(getPageCacheRevision(first), "1");
    assert.equal(state.requests.filter(item => item.path.endsWith("/view-revision")).length, 2);
    assert.match(createPageHeaders(first).get("Server-Timing"), /page_cache_miss;desc="1"/);
    const second = request();
    await readTargets(second);
    assert.equal(state.requests.filter(item => item.path.endsWith("/view-targets")).length, 1);
    assert.equal(state.requests.filter(item => item.path.endsWith("/view-revision")).length, 3);
    assert.match(createPageHeaders(second).get("Server-Timing"), /page_cache_hit;desc="1"/);
    assert.match(createPageHeaders(second).get("Cache-Control"), /private, no-store/);
    state.revisionAvailable = false;
    state.targetName = "latest";
    const missing = request();
    assert.equal((await readTargets(missing))[0].name, "latest");
    assert.equal(getPageCacheRevision(missing), null);
    assert.equal(hasPageVersionConflict(missing), false);
    const revisionReads = state.requests.filter(item => item.path.endsWith("/view-revision")).length;
    const session = new Request("https://example.test/", { headers: { Cookie: "sb-example-auth-token.0=example" } });
    assert.equal((await readTargets(session))[0].name, "latest");
    assert.equal(getPageCacheRevision(session), null);
    assert.equal(state.requests.filter(item => item.path.endsWith("/view-revision")).length, revisionReads);
  });
});

test("request integration detects mixed query versions and resets whole-loader validation", async () => {
  await withGatewayFixture(async state => {
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
  await withGatewayFixture(async state => {
    const first = new Request("https://example.test/");
    await readLogs(first, ["example"], 60, new Date("2026-11-01T10:00:00.000Z"));
    const second = new Request("https://example.test/");
    await readLogs(second, ["example"], 60, new Date("2026-11-01T10:00:00.001Z"));
    assert.equal(state.requests.filter(item => item.path.endsWith("/view-logs")).length, 2);
    assert.equal(getPageCacheRevision(first), "1");
    assert.equal(getPageCacheRevision(second), "1");
  });
});

test("does not store relative-month API data under the previous month's cache key", async () => {
  const NativeDate = Date;
  let currentTime = "2026-11-30T14:59:59.999Z";
  globalThis.Date = class extends NativeDate {
    constructor(...arguments_) { super(...(arguments_.length ? arguments_ : [currentTime])); }
    static now() { return NativeDate.parse(currentTime); }
  };
  try {
    await withGatewayFixture(async state => {
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
