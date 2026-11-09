import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const label = process.argv[2] ?? 'before';
const origin = 'http://127.0.0.1:3087';
const buildDirectory = process.env.PERFORMANCE_BUILD ?? (label.startsWith('before') ? 'build-before' : 'build');
const server = spawn(process.execPath, [`${buildDirectory}/server.js`], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: '3087' } });
let serverErrors = '';
server.stderr.on('data', chunk => { serverErrors += chunk; });
const ready = new Promise((resolve, reject) => {
  server.stdout.on('data', chunk => { if (chunk.toString().includes('サーバー起動')) resolve(); });
  server.once('exit', code => reject(new Error(`server exit ${code}: ${serverErrors}`)));
});
let browser;
try {
  await ready;
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const results = { label, browser: browser.version(), timestamp: new Date().toISOString(), api: [], pages: [], transitions: [] };
  for (const route of ['/api/v1/targets', '/api/v1/errors/0', '/api/v1/incidents/0']) {
    for (let index = 0; index < 5; index++) {
      const start = performance.now();
      const response = await fetch(origin + route, { signal: AbortSignal.timeout(20000) });
      const body = await response.json();
      results.api.push({ route, ms: performance.now() - start, status: response.status, hasError: !!body.error, count: Array.isArray(body.data) ? body.data.length : body.data?.logs?.length });
    }
  }
  for (let index = 0; index < 5; index++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__lcp = 0;
      new PerformanceObserver(list => { for (const item of list.getEntries()) window.__lcp = item.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    for (const route of ['/', '/incidents', '/errors', '/login']) {
      const start = performance.now();
      await page.goto(origin + route, { waitUntil: 'load', timeout: 45000 });
      let isReady = true;
      await page.waitForFunction(() => !document.querySelector('main .animate-spin'), { timeout: 30000 }).catch(() => { isReady = false; });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const readyMs = performance.now() - start;
      const metrics = await page.evaluate(() => ({ ttfb: performance.getEntriesByType('navigation')[0].responseStart, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime, lcp: window.__lcp, serverTiming: performance.getEntriesByType('navigation')[0].serverTiming.map(item => ({ name: item.name, duration: item.duration, description: item.description })), resources: performance.getEntriesByType('resource').map(item => ({ name: new URL(item.name).pathname, ms: item.duration, bytes: item.transferSize })) }));
      isReady = isReady && await page.getByRole('alert').count() === 0;
      results.pages.push({ route, readyMs, isReady, ...metrics, pageErrors: [...pageErrors] });
      console.log(`${label}: ${index + 1}/5 ${route} ${readyMs.toFixed(1)}ms ready=${isReady}`);
    }
    for (const mode of ['intent', 'direct']) for (const [name, route] of (mode === 'intent' ? [['ホーム', '/'], ['インシデント', '/incidents'], ['エラー', '/errors'], ['ログイン', '/login'], ['ホーム', '/']] : [['インシデント', '/incidents'], ['エラー', '/errors'], ['ログイン', '/login'], ['ホーム', '/']])) {
      const link = page.getByRole('link', { name, exact: true });
      if (mode === 'intent') {
        await link.hover();
        await page.waitForTimeout(150);
      }
      const elapsed = await page.evaluate(async ({ name, route }) => {
        const link = [...document.querySelectorAll('header a')].find(element => element.textContent.trim() === name);
        const start = performance.now();
        link.click();
        await new Promise((resolve, reject) => {
          const check = () => {
            const activeLink = document.querySelector('header a[aria-current="page"]');
            if (performance.now() - start > 30000) { reject(new Error('Navigation timed out')); return; }
            if (location.pathname === route && activeLink?.getAttribute('href') === route && document.querySelector('main')?.getAttribute('aria-busy') !== 'true' && !document.querySelector('main .animate-spin')) requestAnimationFrame(() => requestAnimationFrame(() => {
              if (!document.querySelector('main .animate-spin') && document.querySelector('main')?.getAttribute('aria-busy') !== 'true') resolve(); else check();
            }));
            else requestAnimationFrame(check);
          };
          check();
        });
        return performance.now() - start;
      }, { name, route });
      results.transitions.push({ route, mode, ms: elapsed });
    }
    await context.close();
  }
  await writeFile(`performance-${label}.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, (key, value) => key === 'resources' ? undefined : value));
} finally {
  await browser?.close();
  server.kill();
}
