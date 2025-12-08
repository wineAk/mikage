import express from "express";
import fetch from "node-fetch";
import { createRequestHandler } from "@react-router/express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createClient } from "./app/lib/supabase/index.js";

// .envファイルから環境変数を読み込み
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 80;

// セキュリティ対策: X-Powered-Byヘッダーを無効化（情報漏洩防止）
app.disable('x-powered-by');

// ALLOWED_IPS（カンマ区切り）を配列に
const allowedIps = (process.env.ALLOWED_IPS || "").split(",").map(ip => ip.trim()).filter(Boolean);
console.log('allowedIps:', allowedIps);

// IP制御ミドルウェア（staticルートより前に）
app.use((req, res, next) => {
  const reqHeadForwardedFor = req.headers["x-forwarded-for"];
  const reqIp = (Array.isArray(reqHeadForwardedFor) ? reqHeadForwardedFor[0] : reqHeadForwardedFor) || req.ip;
  const ipToCheck = reqIp || "";
  const ipList = ipToCheck.split(",").map(ip => ip.trim());
  const isAllowed = allowedIps.length === 0 || ipList.some(ip => allowedIps.includes(ip));
  console.log('req.path:', req.path);
  console.log('reqHeadForwardedFor:', reqHeadForwardedFor);
  console.log('reqIp:', reqIp);
  console.log('isAllowed:', isAllowed);
  // /api/v1/watch だけはIP制限スキップ
  if (/\/api\/v1\/watch/.test(req.path)) {
    return next();
  }
  // 許可IP以外は403エラー
  if (!isAllowed) {
    res.status(403).send("アクセスが許可されていません（IP制限）");
    return;
  }
  next();
});

// XSS対策: Content Security Policy (CSP) ヘッダーを設定するミドルウェア
app.use((req, res, next) => {
  // CSPヘッダーを設定（XSS攻撃を緩和）
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; object-src 'none';"
  );
  // XSS Protection ヘッダー
  res.setHeader("X-XSS-Protection", "1; mode=block");
  // X-Content-Type-Options ヘッダー（MIMEタイプスニッフィング防止）
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

// staticルートを一番最初に
//app.use("/assets", express.static(path.join(__dirname, "client/assets")));
app.use(express.static(path.join(__dirname, "client")));

/**
 * XSS対策: HTMLエスケープ関数
 * 特殊文字をHTMLエンティティに変換してXSS攻撃を防止
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * XSS対策: 外部HTMLから危険な要素を削除
 * プロキシの目的上、完全なサニタイズは難しいが、最低限の危険要素を削除
 */
function sanitizeExternalHtml(html: string): string {
  // インラインイベントハンドラを削除（onclick, onerrorなど）
  html = html.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  html = html.replace(/\s+on\w+\s*=\s*[^\s>]*/gi, '');
  
  // javascript:プロトコルを無効化
  html = html.replace(/javascript:/gi, '');
  
  return html;
}

// HTMLに<base>と操作禁止のスタイル・スクリプトを注入
function injectLockOverlay(html: string, baseHref: string) {
  const headTag = /<head[^>]*>/i;
  // XSS対策: baseHrefをエスケープ（属性値として安全に処理）
  const safeBaseHref = baseHref.replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const baseTag = `<base href="${safeBaseHref}">`;
  const styleScript = `
    <style>
      html, body {
        pointer-events: none !important;
        user-select: none !important;
        overflow: hidden !important;
      }
      body::after {
        content: "";
        display: block;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0);
        z-index: 1000;
      }
    </style>
    <script>
      // ページ内のすべてのイベントを無効化
      document.addEventListener("DOMContentLoaded", () => {
        const blockEvent = e => {
          e.stopPropagation();
          e.preventDefault();
          return false;
        };
        [
          "click", "dblclick", "mousedown", "mouseup", "keydown", "keyup",
          "submit", "contextmenu", "wheel", "touchstart", "touchend"
        ].forEach(ev => window.addEventListener(ev, blockEvent, true));

        // コンソールをブロック
        const originalConsole = {
          log: console.log,
          error: console.error,
          warn: console.warn,
          info: console.info,
          debug: console.debug
        };

        Object.keys(originalConsole).forEach(method => {
          console[method] = function() {
            // コンソール出力を無効化
            return;
          };
        });

        // F12やCtrl+Shift+Iなどのデベロッパーツールを開くショートカットを無効化
        document.addEventListener('keydown', (e) => {
          if (
            (e.key === 'F12') ||
            (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C'))
          ) {
            e.preventDefault();
            return false;
          }
        });
      });
    </script>`;

  return html
    .replace(headTag, (match) => `${match}\n${baseTag}`)
    .replace(headTag, (match) => `${match}\n${styleScript}`);
}

// /:key にアクセスされたときのプロキシ処理
app.get("/:key", async (req, res, next) => {
  const key = req.params.key;
  console.log('key:', key);
  if (typeof key !== "string") return res.redirect("/");
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const fullUrl = new URL(key, baseUrl).toString();
  console.log('baseUrl:', baseUrl);
  console.log('fullUrl:', fullUrl);
  try {
    const fetchRequest = new Request(fullUrl, {
      method: req.method,
      headers: new Headers(
        Object.entries(req.headers).map(
          ([k, v]) =>
            [k, Array.isArray(v) ? v.join(",") : v ?? ""] as [string, string]
        )
      ),
    });

    const { supabase } = createClient(fetchRequest, "mikage");
    const { data } = await supabase.from("targets").select("*").eq("key", key);
    if (!data || data.length === 0) return next(); // DBに存在しないkeyはReact Routerに処理を委ねる
    const { name, url, headers } = data[0]; // 1件目を使う
    // 接続
    // https://(.*).saaske.com, https://(.*.).secure-link.jp, https://www.interpark.co.jp, https://(.*).works.app/ だけ許可
    if (!/https:\/\/(?:(?:api|my|www|works)\.saaske\.com|(?:script\.)?secure-link\.jp|www\.interpark\.co\.jp|kensyo-tes2?\.works\.app\/)/.test(url)) return next();
    const response = await fetch(url, { headers });
    let body = await response.text();
    
    // XSS対策: 外部HTMLをサニタイズ
    body = sanitizeExternalHtml(body);
    body = injectLockOverlay(body, url);
    
    // Content-TypeがHTMLの場合のみ処理
    const contentType = response.headers.get("content-type") || "text/html";
    res.set("Content-Type", contentType);
    res.status(response.status);
    res.send(body);
  } catch (error) {
    console.error("Proxy Error:", error);
    res.status(500).send("❌ 外部アクセスに失敗しました");
  }
});

// React Router v7 の SSR（最終的なcatch-all）
app.use(
  createRequestHandler({
    // @ts-ignore
    build: await import("./server/index.js"),
    mode: process.env.NODE_ENV || "production",
  })
);

app.listen(PORT, () => {
  console.log(`✅ サーバー起動: http://localhost:${PORT}`);
});
