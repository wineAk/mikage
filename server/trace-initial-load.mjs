import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const server = spawn(process.execPath, ["build/server.js"], { env: { ...process.env, PORT: "3087" }, stdio: ["ignore", "pipe", "pipe"] });
const ready = new Promise((resolve, reject) => {
  server.stdout.on("data", chunk => { if (chunk.toString().includes("サーバー起動")) resolve(); });
  server.once("exit", code => reject(new Error(`server exit ${code}`)));
});
let browser;
try {
  await ready;
  for (const path of ["/api/v1/targets", "/api/v1/errors/0"]) await (await fetch(`http://127.0.0.1:3087${path}`)).text();
  browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const client = await page.context().newCDPSession(page);
  const events = [];
  client.on("Tracing.dataCollected", ({ value }) => events.push(...value));
  await client.send("Tracing.start", { categories: "devtools.timeline,v8,blink.user_timing,loading,disabled-by-default-devtools.timeline", transferMode: "ReportEvents" });
  const response = await page.goto("http://127.0.0.1:3087", { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector("main")?.getAttribute("aria-busy") === "false");
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const completed = new Promise(resolve => client.once("Tracing.tracingComplete", resolve));
  await client.send("Tracing.end");
  await completed;
  const timings = await page.evaluate(() => ({
    navigation: performance.getEntriesByType("navigation")[0].toJSON(),
    paints: performance.getEntriesByType("paint").map(entry => entry.toJSON()),
    resources: performance.getEntriesByType("resource").map(entry => ({ name: new URL(entry.name).pathname, startTime: entry.startTime, duration: entry.duration, responseEnd: entry.responseEnd, transferSize: entry.transferSize })),
  }));
  delete timings.navigation.name;
  const totals = new Map();
  for (const event of events) {
    if (event.ph !== "X" || !event.dur) continue;
    const total = totals.get(event.name) ?? { name: event.name, count: 0, totalMs: 0, maxMs: 0 };
    total.count++;
    total.totalMs += event.dur / 1000;
    total.maxMs = Math.max(total.maxMs, event.dur / 1000);
    totals.set(event.name, total);
  }
  const result = { status: response.status(), serverTiming: response.headers()["server-timing"], timings, tasks: [...totals.values()].sort((first, second) => second.totalMs - first.totalMs).slice(0, 25) };
  await writeFile("performance-initial-trace.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser?.close(); server.kill(); }
