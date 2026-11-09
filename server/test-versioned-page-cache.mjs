import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, request as requestHttp } from "node:http";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error("PLAYWRIGHT_MODULEを指定してください。");
const { chromium } = await import(pathToFileURL(modulePath).href);
const origin = "http://127.0.0.1:3087";
const targets = [
  { key: "web_interpark", name: "Example Web" },
  { key: "works07", name: "Example Works" },
  { key: "saaske02", name: "Example SaaS" },
];
const state = {
  version: 1,
  revisionMode: "available",
  label: "Initial-Row",
  hasRows: true,
  failErrors: false,
  mutateDuringNextErrorRead: null,
  targetName: null,
  requests: [],
};
const completedTests = [];
const pageErrors = [];
const measurements = {};
let browser;
let server;

function revisionToken() {
  return `11111111-1111-4111-8111-111111111111:${state.version}:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`;
}

function changeRows(label, hasRows = true) {
  state.version++;
  state.label = label;
  state.hasRows = hasRows;
}

function createErrorRows() {
  if (!state.hasRows) return [];
  return [{
    name: state.label,
    target_key: "saaske02",
    created_at: new Date(Date.now() - 60_000).toISOString(),
    response_time: 5000,
    status_code: 503,
    status_message: "Unavailable",
    error_code: "HTTP_ERROR",
    error_name: "HTTPError",
  }];
}

function createTargets() {
  return targets.map(target => ({ ...target, name: target.key === "saaske02" && state.targetName !== null ? state.targetName : target.name }));
}

function countReads(suffix) {
  return state.requests.filter(request => request.path.endsWith(suffix)).length;
}

function deferred() {
  let resolve;
  const promise = new Promise(settle => { resolve = settle; });
  return { promise, resolve };
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function withDeadline(promise, milliseconds, description) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(description)), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}

// 本番DBには接続せず、版とデータを同一のfixture状態から返す。
const fixtureServer = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    let body = "";
    for await (const chunk of request) body += chunk;
    const parameters = { ...Object.fromEntries(url.searchParams), ...(body ? JSON.parse(body) : {}) };
    state.requests.push({ path: url.pathname, parameters });
    response.setHeader("Content-Type", "application/json");
    let result;
    if (url.pathname === "/rest/v1/rpc/get_page_cache_revision") {
      if (state.revisionMode === "missing") {
        response.writeHead(404); response.end(JSON.stringify({ code: "PGRST202", message: "Fixture revision RPC is unavailable" })); return;
      }
      if (state.revisionMode === "error") {
        response.writeHead(503); response.end(JSON.stringify({ code: "FIXTURE_UNAVAILABLE", message: "Fixture revision check failed" })); return;
      }
      result = state.revisionMode === "null" ? null : revisionToken();
    } else if (url.pathname === "/rest/v1/rpc/get_error_logs") {
      if (state.failErrors) {
        response.writeHead(503); response.end(JSON.stringify({ code: "FIXTURE_UNAVAILABLE", message: "Fixture data read failed" })); return;
      }
      result = { previous_month_count: 0, next_month_count: 0, logs: createErrorRows() };
      if (state.mutateDuringNextErrorRead !== null) {
        const mutation = state.mutateDuringNextErrorRead;
        state.mutateDuringNextErrorRead = null;
        changeRows(typeof mutation === "string" ? mutation : mutation.label);
        if (typeof mutation !== "string") state.targetName = mutation.targetName;
      }
    } else if (url.pathname === "/rest/v1/targets") {
      const rows = createTargets();
      result = request.headers.accept?.includes("vnd.pgrst.object") ? rows[0] : rows;
    } else if (url.pathname === "/rest/v1/rpc/get_logs_in_range") {
      result = createTargets().map(target => ({ ...target, logs: [{ created_at: new Date(Date.now() - 60_000).toISOString(), response_time: 1000, status_code: 200, status_message: null, error_code: null, error_name: null }] }));
    } else if (url.pathname === "/rest/v1/incidents") {
      result = [];
    } else {
      response.writeHead(404); response.end(JSON.stringify({ code: "FIXTURE_UNKNOWN_PATH", message: "Unexpected fixture request" })); return;
    }
    response.end(JSON.stringify(result));
  } catch {
    if (!response.headersSent) response.writeHead(500);
    response.end(JSON.stringify({ code: "FIXTURE_FAILED", message: "Fixture processing failed" }));
  }
});

async function readErrorsPage(headers = {}) {
  const response = await fetch(`${origin}/errors`, { headers, signal: AbortSignal.timeout(15_000) });
  return { status: response.status, html: await response.text(), timing: response.headers.get("server-timing"), cacheControl: response.headers.get("cache-control") };
}

async function waitForReady(page) {
  await page.waitForFunction(() => document.querySelector("main")?.getAttribute("aria-busy") === "false");
  await page.waitForFunction(() => !document.querySelector("main .animate-spin"));
}

async function openRevisionStream(cookie, path = "/api/v1/updates") {
  let outgoing;
  const response = await withDeadline(new Promise((resolve, reject) => {
    outgoing = requestHttp(`${origin}${path}`, { headers: { Cookie: cookie }, agent: false }, resolve);
    outgoing.once("error", reject);
    outgoing.end();
  }), 5000, "SSE接続を開始できませんでした。");
  assert.equal(response.statusCode, 200);
  const reader = Readable.toWeb(response).getReader();
  const decoder = new TextDecoder();
  async function event(name) {
    return withDeadline((async () => {
      let text = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`SSE ${name} 通知の前に接続が終了しました。`);
        text += decoder.decode(chunk.value, { stream: true });
        if (text.includes(`event: ${name}\n`)) return text;
      }
    })(), 3500, `SSE ${name} 通知を受信できませんでした。`);
  }
  async function close() {
    // 接続数の試験はHTTPクライアントのpoolへ戻さず、実ソケットを切断する。
    response.destroy();
    outgoing.destroy();
    try { await reader.cancel(); } catch {}
  }
  return { event, close };
}

try {
  await new Promise(resolve => fixtureServer.listen(0, "127.0.0.1", resolve));
  const fixturePort = fixtureServer.address().port;
  server = spawn(process.execPath, ["build/server.js"], {
    env: { ...process.env, PAGE_CACHE_ENABLED: "true", TZ: "UTC", PORT: "3087", VITE_SUPABASE_URL: `http://127.0.0.1:${fixturePort}`, VITE_SUPABASE_ANON_KEY: "example-anon-key" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverErrors = "";
  server.stderr.on("data", chunk => { serverErrors += chunk; });
  await new Promise((resolve, reject) => {
    server.stdout.on("data", chunk => { if (chunk.toString().includes("サーバー起動")) resolve(); });
    server.once("exit", code => reject(new Error(`server exit ${code}: ${serverErrors}`)));
  });

  const initialReads = countReads("/get_error_logs");
  const first = await readErrorsPage();
  const second = await readErrorsPage();
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.match(second.html, /Initial-Row/);
  assert.match(second.cacheControl, /private.*no-store/);
  assert.equal(countReads("/get_error_logs") - initialReads, 1);
  assert.ok(countReads("/get_page_cache_revision") >= 3);
  if (second.timing !== null) assert.match(second.timing, /page_cache_hit;desc="[1-9]\d*"/);
  completedTests.push("同じ版の2要求でも版をDBで検証し、重い集計は1回だけにする");

  changeRows("Updated-Row");
  const updated = await readErrorsPage();
  assert.match(updated.html, /Updated-Row/);
  assert.doesNotMatch(updated.html, /Initial-Row/);
  completedTests.push("既存行更新で版が変わると古い値を返さない");

  changeRows("Deleted-Row", false);
  const deleted = await readErrorsPage();
  assert.equal(deleted.status, 200);
  assert.doesNotMatch(deleted.html, /Updated-Row/);
  completedTests.push("削除で版が変わるとキャッシュ中の行も消える");

  changeRows("Before-Failure");
  assert.match((await readErrorsPage()).html, /Before-Failure/);
  state.revisionMode = "error";
  state.failErrors = true;
  const failed = await readErrorsPage();
  assert.equal(failed.status, 503);
  assert.doesNotMatch(failed.html, /Before-Failure/);
  state.revisionMode = "available";
  state.failErrors = false;
  changeRows("Recovered-Row");
  assert.match((await readErrorsPage()).html, /Recovered-Row/);
  completedTests.push("版検証とデータ取得の失敗時は旧成功キャッシュに戻らず503にする");

  for (const mode of ["missing", "null"]) {
    state.revisionMode = mode;
    const beforeReads = countReads("/get_error_logs");
    state.label = `Bypass-${mode}-A`;
    assert.match((await readErrorsPage()).html, new RegExp(state.label));
    state.label = `Bypass-${mode}-B`;
    assert.match((await readErrorsPage()).html, new RegExp(state.label));
    assert.equal(countReads("/get_error_logs") - beforeReads, 2);
  }
  state.revisionMode = "available";
  completedTests.push("版RPC未導入・利用不可なら各要求で新しく読み、TTLで代用しない");

  changeRows("Authenticated-A");
  const beforeAuthReads = countReads("/get_error_logs");
  const beforeAuthRevisions = countReads("/get_page_cache_revision");
  const authHeaders = { Cookie: "sb-example-auth-token=example-session" };
  assert.match((await readErrorsPage(authHeaders)).html, /Authenticated-A/);
  state.label = "Authenticated-B";
  assert.match((await readErrorsPage(authHeaders)).html, /Authenticated-B/);
  assert.equal(countReads("/get_error_logs") - beforeAuthReads, 2);
  assert.equal(countReads("/get_page_cache_revision"), beforeAuthRevisions);
  const beforeAuthorizationReads = countReads("/get_error_logs");
  await readErrorsPage({ Authorization: "Bearer example-token" });
  await readErrorsPage({ Authorization: "Bearer example-token" });
  assert.equal(countReads("/get_error_logs") - beforeAuthorizationReads, 2);
  completedTests.push("認証Cookie・Authorization付き要求は共有結果キャッシュを使わない");

  changeRows("Scope-A");
  const scopeA = { Cookie: "cf_example=scope-a" };
  const scopeB = { Cookie: "cf_example=scope-b" };
  const scopeReads = countReads("/get_error_logs");
  assert.match((await readErrorsPage(scopeA)).html, /Scope-A/);
  assert.match((await readErrorsPage(scopeA)).html, /Scope-A/);
  state.label = "Scope-B";
  assert.match((await readErrorsPage(scopeB)).html, /Scope-B/);
  assert.match((await readErrorsPage(scopeB)).html, /Scope-B/);
  assert.equal(countReads("/get_error_logs") - scopeReads, 2);
  completedTests.push("任意Cookieを含む匿名要求も別scope同士でキャッシュを混ぜない");

  changeRows("Race-Old");
  state.mutateDuringNextErrorRead = "Race-New";
  const raceReads = countReads("/get_error_logs");
  const raced = await readErrorsPage();
  assert.equal(raced.status, 200);
  assert.match(raced.html, /Race-New/);
  assert.doesNotMatch(raced.html, /Race-Old/);
  assert.ok(countReads("/get_error_logs") - raceReads >= 2);
  const readsAfterRace = countReads("/get_error_logs");
  assert.match((await readErrorsPage()).html, /Race-New/);
  assert.equal(countReads("/get_error_logs"), readsAfterRace);
  completedTests.push("取得途中に版が変わった応答は捨てて再取得し、新版だけを保存する");

  // 先に保存した対象一覧と、取得中に変わるエラー一覧を混在させない。
  changeRows("Snapshot-Error-Old");
  state.targetName = "Snapshot-Target-Old";
  const seededTargets = await fetch(`${origin}/login`);
  assert.equal(seededTargets.status, 200);
  assert.match(await seededTargets.text(), /Snapshot-Target-Old/);
  state.mutateDuringNextErrorRead = { label: "Snapshot-Error-New", targetName: "Snapshot-Target-New" };
  const mixedResponse = await fetch(`${origin}/incidents`);
  const mixedHtml = await mixedResponse.text();
  assert.equal(mixedResponse.status, 200);
  assert.match(mixedHtml, /Snapshot-Target-New/);
  assert.match(mixedHtml, /Snapshot-Error-New/);
  assert.doesNotMatch(mixedHtml, /Snapshot-Target-Old/);
  assert.doesNotMatch(mixedHtml, /Snapshot-Error-Old/);
  state.targetName = null;
  changeRows("After-Snapshot");
  completedTests.push("複数クエリの途中に更新されても画面内に異なる版のデータを混ぜない");

  const beforeSharedPoll = countReads("/get_page_cache_revision");
  const firstStream = await openRevisionStream("sse_scope=shared", "/api/v1/updates/");
  const secondStream = await openRevisionStream("sse_scope=shared");
  try {
    await Promise.all([firstStream.event("revision"), secondStream.event("revision")]);
    assert.equal(countReads("/get_page_cache_revision") - beforeSharedPoll, 1);
    await delay(1150);
    assert.equal(countReads("/get_page_cache_revision") - beforeSharedPoll, 2);
    completedTests.push("同じCookie scopeの2接続で初回・1秒周期のDB版確認を1本へ共有する");
    await firstStream.close();
    state.version++;
    const update = await secondStream.event("revision");
    assert.ok(update.includes(revisionToken()));
    completedTests.push("最初のSSE接続を閉じても残った接続のDB確認と通知を継続する");
  } finally { await firstStream.close(); await secondStream.close(); }
  await delay(150);
  const afterSharedClose = countReads("/get_page_cache_revision");
  await delay(1200);
  assert.equal(countReads("/get_page_cache_revision"), afterSharedClose);
  completedTests.push("最後のSSE接続を閉じたscopeでは共有DB確認を停止する");

  const beforeSeparateScopes = countReads("/get_page_cache_revision");
  const separateStreams = await Promise.all([openRevisionStream("sse_scope=one"), openRevisionStream("sse_scope=two")]);
  try {
    await Promise.all(separateStreams.map(stream => stream.event("revision")));
    assert.equal(countReads("/get_page_cache_revision") - beforeSeparateScopes, 2);
    completedTests.push("Cookieが異なるSSE scopeはproducerと通知経路を共有しない");
  } finally { await Promise.all(separateStreams.map(stream => stream.close())); }
  await delay(150);

  const failedStreams = await Promise.all([openRevisionStream("sse_scope=metadata-failure"), openRevisionStream("sse_scope=metadata-failure")]);
  try {
    await Promise.all(failedStreams.map(stream => stream.event("revision")));
    state.revisionMode = "missing";
    await Promise.all(failedStreams.map(stream => stream.event("unavailable")));
    const afterUnavailable = countReads("/get_page_cache_revision");
    await delay(1200);
    assert.equal(countReads("/get_page_cache_revision"), afterUnavailable);
    completedTests.push("共有DB版確認が利用不能になったら全接続へ通知してproducerを停止する");
  } finally { state.revisionMode = "available"; await Promise.all(failedStreams.map(stream => stream.close())); }
  await delay(150);

  const capacityStreams = [];
  try {
    capacityStreams.push(...await Promise.all(Array.from({ length: 32 }, (_, index) => openRevisionStream(`sse_scope=capacity-${index}`))));
    await Promise.all(capacityStreams.map(stream => stream.event("revision")));
    const refused = await fetch(`${origin}/api/v1/updates`, { headers: { Cookie: "sse_scope=capacity-overflow" } });
    assert.match(await refused.text(), /event: unavailable/);
    completedTests.push("共有SSEのscope上限を超えた接続はDB確認を増やさず通常再取得へ戻す");
  } finally { await Promise.all(capacityStreams.map(stream => stream.close())); }
  await delay(2000);
  const readsAfterCapacityClose = countReads("/get_page_cache_revision");
  await delay(1300);
  assert.equal(countReads("/get_page_cache_revision"), readsAfterCapacityClose, "上限試験の全接続を閉じた後にDB監視が残っています。");

  browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.clock.install();
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => { if (/hydration|hydrated|server rendered/i.test(message.text())) pageErrors.push(message.text()); });
  await page.addInitScript(() => {
    window.__pageRevisionEvents = [];
    window.__pageUnavailableEvents = 0;
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(...argumentsList) {
        super(...argumentsList);
        this.addEventListener("revision", event => {
          try { window.__pageRevisionEvents.push(JSON.parse(event.data).revision); } catch {}
        });
        this.addEventListener("unavailable", () => { window.__pageUnavailableEvents++; });
      }
    };
  });

  changeRows("SSE-Initial");
  const connection = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/updates" && response.status() === 200);
  await page.goto(`${origin}/errors`);
  await connection;
  await waitForReady(page);
  await page.getByText("SSE-Initial", { exact: true }).waitFor();
  const changedAt = performance.now();
  changeRows("SSE-Updated");
  await page.getByText("SSE-Updated", { exact: true }).waitFor({ timeout: 3500 });
  measurements.sseUpdateMs = performance.now() - changedAt;
  completedTests.push("開いた画面も実際のSSE版通知で3.5秒以内に新しい値へ追随する");

  // サーバーで旧版の読取が完了した後の応答だけを保留し、通知がbusy中に届く状態を作る。
  const held = deferred();
  const release = deferred();
  let shouldHoldResponse = true;
  await page.route("**/errors.data*", async route => {
    if (!shouldHoldResponse) { await route.continue(); return; }
    shouldHoldResponse = false;
    const response = await route.fetch();
    held.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  changeRows("Busy-Intermediate");
  const beforeBusyReads = countReads("/get_error_logs");
  await page.getByRole("button", { name: "最新データに更新", exact: true }).click();
  try {
    await withDeadline(held.promise, 5000, "更新中のloader応答を保留できませんでした。");
    await page.locator('main[aria-busy="true"]').waitFor();
    changeRows("Busy-Latest");
    const latestToken = revisionToken();
    await page.waitForFunction(token => window.__pageRevisionEvents.includes(token), latestToken, { timeout: 3500 });
  } finally { release.resolve(); }
  await page.getByText("Busy-Latest", { exact: true }).waitFor({ timeout: 5000 });
  await waitForReady(page);
  await delay(250);
  assert.ok(countReads("/get_error_logs") - beforeBusyReads >= 2);
  assert.ok(countReads("/get_error_logs") - beforeBusyReads <= 3);
  completedTests.push("更新中に新版通知が来ても捨てず、待機中の旧応答の後で新版へ追随する");

  changeRows("SSE-Failure");
  state.failErrors = true;
  await page.getByRole("alert").waitFor({ timeout: 5000 });
  const readsAtFailure = countReads("/get_error_logs");
  await delay(2300);
  assert.equal(countReads("/get_error_logs"), readsAtFailure);
  state.failErrors = false;
  state.label = "SSE-Recovered";
  await page.getByRole("button", { name: "最新データに更新", exact: true }).click();
  await page.getByText("SSE-Recovered", { exact: true }).waitFor();
  await waitForReady(page);
  completedTests.push("SSE再検証失敗で無限要求を起こさず、同じ版でも手動更新で復旧する");

  const unavailableEvents = await page.evaluate(() => window.__pageUnavailableEvents);
  state.revisionMode = "missing";
  await page.waitForFunction(count => window.__pageUnavailableEvents > count, unavailableEvents);
  state.revisionMode = "available";
  changeRows("SSE-Reconnected");
  const reconnectedRevision = revisionToken();
  await page.clock.fastForward(60_000);
  await page.waitForFunction(revision => window.__pageRevisionEvents.includes(revision), reconnectedRevision);
  await page.getByText("SSE-Reconnected", { exact: true }).waitFor();
  await waitForReady(page);
  completedTests.push("通知機能が復旧したら画面を開いたまま60秒の再接続でSSE通知を再開する");

  assert.deepEqual(pageErrors, []);
  completedTests.push("SSR hydration警告とブラウザー例外なし");
  await context.close();
  await browser.close();
  browser = undefined;
  // Chromeのネットワークプロセスから切断が届くまでの猶予を含めて確認する。
  await delay(2000);
  const revisionReadsAfterClose = countReads("/get_page_cache_revision");
  await delay(1300);
  assert.equal(countReads("/get_page_cache_revision"), revisionReadsAfterClose);
  completedTests.push("ブラウザー終了後は変更確認のDB要求を継続しない");
  const results = { measuredAt: new Date().toISOString(), passed: completedTests.length, tests: completedTests, measurements, productionDatabaseTouched: false };
  const reportDate = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  await mkdir("docs", { recursive: true });
  await writeFile(`docs/performance-cache-validation-${reportDate}.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser?.close();
  server?.kill();
  fixtureServer.closeAllConnections();
  await new Promise(resolve => fixtureServer.close(resolve));
}
