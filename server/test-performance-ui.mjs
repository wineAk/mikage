import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error("PLAYWRIGHT_MODULEを指定してください。");
const { chromium } = await import(pathToFileURL(modulePath).href);
const origin = "http://127.0.0.1:3087";
const targets = [
  { key: "web_interpark", name: "Example Web" },
  { key: "works07", name: "Example Works" },
  { key: "saaske02", name: "Example SaaS A" },
  { key: "saaske04", name: "Example SaaS B" },
];
const fixtureState = { mode: "success", responseTime: 1000, logDelay: 0, requests: [] };
const completedTests = [];
const pageErrors = [];
const externalRequests = [];
let browser;
let server;

function createLogs(responseTime) {
  return targets.map(target => ({
    ...target,
    logs: [2, 1].map(minutes => ({
      created_at: new Date(Date.now() - minutes * 60_000).toISOString(),
      response_time: responseTime,
      status_code: 200,
      status_message: null,
      error_code: null,
      error_name: null,
    })),
  }));
}

function createErrorLogs() {
  return [2, 1].map(minutes => ({
    name: "Example SaaS A",
    target_key: "saaske02",
    created_at: new Date(Date.now() - minutes * 60_000).toISOString(),
    response_time: 5000,
    status_code: 503,
    status_message: "Unavailable",
    error_code: "HTTP_ERROR",
    error_name: "HTTPError",
  }));
}

// DBは使わず、SSRとブラウザーの両方から利用できるローカルREST応答を用意する。
const fixtureServer = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  let body = "";
  for await (const chunk of request) body += chunk;
  const parameters = body ? JSON.parse(body) : {};
  fixtureState.requests.push({ path: url.pathname, parameters });
  response.setHeader("Content-Type", "application/json");
  let result;
  if (url.pathname === "/rest/v1/targets") {
    if (fixtureState.mode === "targets-fail") {
      response.writeHead(503); response.end(JSON.stringify({ message: "unavailable" })); return;
    }
    result = request.headers.accept?.includes("vnd.pgrst.object") ? targets[0] : targets;
  } else if (url.pathname === "/rest/v1/rpc/get_logs_in_range") {
    if (fixtureState.mode === "logs-fail") {
      response.writeHead(503); response.end(JSON.stringify({ message: "unavailable" })); return;
    }
    const minute = Math.round((Date.parse(parameters.end_time) - Date.parse(parameters.start_time)) / 60_000);
    if (minute === 30) await new Promise(resolve => setTimeout(resolve, 500));
    else if (fixtureState.logDelay > 0) await new Promise(resolve => setTimeout(resolve, fixtureState.logDelay));
    result = createLogs(minute === 10 ? 2000 : minute === 30 ? 9000 : fixtureState.responseTime);
  } else if (url.pathname === "/rest/v1/rpc/get_error_logs") {
    if (fixtureState.mode === "errors-fail") {
      response.writeHead(503); response.end(JSON.stringify({ message: "unavailable" })); return;
    }
    result = { previous_month_count: 1, next_month_count: 1, logs: createErrorLogs() };
  } else if (url.pathname === "/rest/v1/incidents") {
    result = [{ keyword: "saaske", created_at: new Date(Date.now() - 3 * 60_000).toISOString(), updated_at: new Date().toISOString(), count: 2, is_closed: false, googlechat_name: null, instatus_id: null }];
  } else {
    response.writeHead(404); response.end(JSON.stringify({ message: `Unexpected fixture path: ${url.pathname}` })); return;
  }
  response.end(JSON.stringify(result));
});

async function createTestPage() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.hostname !== "127.0.0.1") externalRequests.push(url.hostname);
  });
  await page.clock.install();
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => {
    if (/hydration|hydrated|server rendered/i.test(message.text())) pageErrors.push(message.text());
  });
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  return { context, page };
}

async function waitForReady(page, path) {
  await page.waitForURL(origin + path);
  await page.waitForFunction(() => document.querySelector("main")?.getAttribute("aria-busy") === "false");
  await page.waitForFunction(() => !document.querySelector("main .animate-spin"));
}

function summaryRow(page) {
  return page.locator("main table tbody tr").filter({ hasText: "Example Web" });
}

try {
  await new Promise(resolve => fixtureServer.listen(0, "127.0.0.1", resolve));
  const fixturePort = fixtureServer.address().port;
  server = spawn(process.execPath, ["build/server.js"], {
    env: { ...process.env, TZ: "UTC", PORT: "3087", VITE_SUPABASE_URL: `http://127.0.0.1:${fixturePort}`, VITE_SUPABASE_ANON_KEY: "example-anon-key" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverErrors = "";
  server.stderr.on("data", chunk => { serverErrors += chunk; });
  await new Promise((resolve, reject) => {
    server.stdout.on("data", chunk => { if (chunk.toString().includes("サーバー起動")) resolve(); });
    server.once("exit", code => reject(new Error(`server exit ${code}: ${serverErrors}`)));
  });
  const firstResponse = await fetch(origin);
  const serverHtml = await firstResponse.text();
  assert.equal(firstResponse.status, 200);
  assert.match(firstResponse.headers.get("cache-control"), /private.*no-store/);
  assert.match(firstResponse.headers.get("server-timing"), /supabase/);
  assert.match(serverHtml, /data-chart-line/);
  assert.match(serverHtml, /Example Web/);
  assert.doesNotMatch(serverHtml, /animate-spin/);
  completedTests.push("初回HTMLに最新グラフ・サマリーを含みno-storeとDB時間を返す");

  browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const { context, page } = await createTestPage();
  const browserApiRequests = [];
  page.on("request", request => { const path = new URL(request.url()).pathname; if (path.startsWith("/api/") && path !== "/api/v1/updates") browserApiRequests.push(request.url()); });
  await page.goto(origin);
  await waitForReady(page, "/");
  assert.equal(await page.locator("[data-chart-line]").count() > 0, true);
  assert.deepEqual(browserApiRequests, []);
  completedTests.push("hydration後のtargets→logs API通信を発生させない");

  const graph = page.getByRole("img", { name: "応答時間グラフ。左右の矢印キーで計測値を確認できます。", exact: true }).first();
  await graph.focus();
  await graph.press("ArrowLeft");
  await page.getByRole("tooltip").waitFor();
  assert.equal(await page.getByRole("tooltip").getByText("1.00 s", { exact: true }).count(), 1);
  await graph.press("Escape");
  const bounds = await graph.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.5);
  await page.getByRole("tooltip").waitFor();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: "performance-ui-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const graph = document.querySelector('svg[aria-label^="応答時間グラフ"]');
    return graph && Math.abs(graph.viewBox.baseVal.width - graph.getBoundingClientRect().width) < 2;
  });
  await page.screenshot({ path: "performance-ui-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  completedTests.push("SVGのキーボード・pointer tooltipとモバイル幅追従");

  const firstTargetReads = fixtureState.requests.filter(request => request.path.endsWith("/targets")).length;
  for (const [name, route] of [["インシデント", "/incidents"], ["エラー", "/errors"], ["ログイン", "/login"]]) {
    await page.getByRole("link", { name, exact: true }).click();
    await waitForReady(page, route);
    if (route === "/incidents") await page.getByText("down", { exact: true }).waitFor();
  }
  fixtureState.responseTime = 4000;
  await page.getByRole("link", { name: "ホーム", exact: true }).click();
  await waitForReady(page, "/");
  assert.equal(await summaryRow(page).getByText("4.00 秒", { exact: true }).count(), 4);
  assert.equal(fixtureState.requests.filter(request => request.path.endsWith("/targets")).length > firstTargetReads, true);
  completedTests.push("4画面の遷移・即時再訪問でDBを再取得し変更値を表示");

  fixtureState.responseTime = 5000;
  await page.getByRole("button", { name: "最新データに更新", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("main")?.getAttribute("aria-busy") === "false");
  await summaryRow(page).getByText("5.00 秒", { exact: true }).first().waitFor();
  completedTests.push("更新ボタンでTTL待ちなく新しい値を取得");

  fixtureState.responseTime = 5500;
  await page.clock.fastForward(60_000);
  await summaryRow(page).getByText("5.50 秒", { exact: true }).first().waitFor();
  completedTests.push("表示中は60秒ごとに最新データを再取得");

  const beforeHiddenReads = fixtureState.requests.filter(request => request.path.endsWith("/get_logs_in_range")).length;
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }));
  await page.clock.fastForward(60_000);
  assert.equal(fixtureState.requests.filter(request => request.path.endsWith("/get_logs_in_range")).length, beforeHiddenReads);
  await page.evaluate(() => { delete document.visibilityState; });
  completedTests.push("非表示中は定期更新のDB要求を増やさない");

  fixtureState.responseTime = 6000;
  fixtureState.logDelay = 150;
  const beforeFocusReads = fixtureState.requests.filter(request => request.path.endsWith("/get_logs_in_range")).length;
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); });
  await page.locator('main[aria-busy="true"]').waitFor();
  await page.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); });
  await summaryRow(page).getByText("6.00 秒", { exact: true }).first().waitFor();
  assert.equal(fixtureState.requests.filter(request => request.path.endsWith("/get_logs_in_range")).length, beforeFocusReads + 1);
  fixtureState.logDelay = 0;
  completedTests.push("画面復帰時に最新データを再取得");

  fixtureState.responseTime = 6500;
  const beforeRestoreReads = fixtureState.requests.filter(request => request.path.endsWith("/get_logs_in_range")).length;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await summaryRow(page).getByText("6.50 秒", { exact: true }).first().waitFor();
  assert.equal(fixtureState.requests.filter(request => request.path.endsWith("/get_logs_in_range")).length, beforeRestoreReads + 1);
  completedTests.push("BFCache復帰通知で保存済み表示を最新データへ更新");

  await page.getByRole("combobox").click();
  const olderPeriodRequest = page.waitForRequest(request => request.url().includes("minute=30"));
  await page.getByRole("option", { name: "30分間", exact: true }).click();
  await olderPeriodRequest;
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "10分間", exact: true }).click();
  await waitForReady(page, "/?minute=10");
  await page.waitForTimeout(650);
  assert.equal(await summaryRow(page).getByText("2.00 秒", { exact: true }).count(), 4);
  assert.equal(await summaryRow(page).getByText("9.00 秒", { exact: true }).count(), 0);
  completedTests.push("期間変更はURLに保持し遅い旧応答で新期間を上書きしない");

  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByRole("button", { name: "全解除", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByText("表示対象が選択されていません。", { exact: true }).waitFor();
  await page.reload();
  await waitForReady(page, "/?minute=10");
  await page.getByText("表示対象が選択されていません。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByRole("button", { name: "全選択", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("saaske_rds_list"))), ["saaske02", "saaske04"]);
  await page.keyboard.press("Escape");
  completedTests.push("表示設定の全解除・全選択・再読込保持を維持");

  await page.getByRole("link", { name: "エラー", exact: true }).click();
  await waitForReady(page, "/errors");
  const beforeBackReads = fixtureState.requests.filter(request => request.path.endsWith("/get_logs_in_range")).length;
  await page.goBack();
  await waitForReady(page, "/?minute=10");
  assert.equal(fixtureState.requests.filter(request => request.path.endsWith("/get_logs_in_range")).length, beforeBackReads + 1);
  const beforeForwardReads = fixtureState.requests.filter(request => request.path.endsWith("/get_error_logs")).length;
  await page.goForward();
  await waitForReady(page, "/errors");
  assert.equal(fixtureState.requests.filter(request => request.path.endsWith("/get_error_logs")).length, beforeForwardReads + 1);
  completedTests.push("戻る・進むでもURLに対応するデータを新しく取得");

  await page.getByRole("button", { name: "前月", exact: true }).click();
  await waitForReady(page, "/errors?offset=1");
  assert.equal(fixtureState.requests.filter(request => request.path.endsWith("/get_error_logs")).at(-1).parameters.start_offset, 1);
  completedTests.push("月移動をURLとDB要求のoffsetに反映");
  fixtureState.mode = "errors-fail";
  await page.getByRole("button", { name: "最新データに更新", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.locator("main table").count(), 0);
  fixtureState.mode = "success";
  await page.getByRole("button", { name: "最新データに更新", exact: true }).click();
  await waitForReady(page, "/errors?offset=1");
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.equal(await page.locator("main table").count(), 1);
  completedTests.push("更新失敗時に前の成功結果を最新版として残さず、再更新で復旧する");
  await context.close();

  for (const mode of ["targets-fail", "logs-fail", "errors-fail"]) {
    fixtureState.mode = mode;
    const { context: errorContext, page: errorPage } = await createTestPage();
    const route = mode === "errors-fail" ? "/errors" : "/";
    const result = await errorPage.goto(origin + route);
    assert.equal(result.status(), 503);
    await errorPage.getByRole("alert").waitFor();
    assert.equal(await errorPage.getByText("選択した期間に監視データがありません。", { exact: true }).count(), 0);
    await errorContext.close();
    completedTests.push(`${mode}: 古い成功データや正常な空結果へ差し替えず失敗を通知`);
  }
  assert.deepEqual(pageErrors, []);
  completedTests.push("ブラウザー例外・SSR hydration警告なし");
  assert.deepEqual(externalRequests, []);
  completedTests.push("初回表示と操作で外部フォント等への通信を発生させない");
  console.log(JSON.stringify({ passed: completedTests.length, tests: completedTests }, null, 2));
} finally {
  await browser?.close();
  server?.kill();
  fixtureServer.closeAllConnections();
  await new Promise(resolve => fixtureServer.close(resolve));
}
