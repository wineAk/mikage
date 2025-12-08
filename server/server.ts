import express from "express";
import fetch from "node-fetch";
import { createRequestHandler } from "@react-router/express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import sanitizeHtml from "sanitize-html";
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
  // プロキシルート（/:key）では外部リソースを許可する必要があるため、CSPを緩和
  if (req.path.match(/^\/[^\/]+$/) && !req.path.startsWith('/api') && !req.path.startsWith('/login')) {
    // プロキシルート: 外部HTMLを表示するため、外部リソースを許可（XSS対策はsanitize-htmlで実現）
    // base-uriをhttps:に変更して外部URLの<base>タグを許可
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self' https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https: fonts.googleapis.com; img-src 'self' data: https:; font-src 'self' data: https: fonts.gstatic.com; connect-src 'self' https:; frame-ancestors 'self'; base-uri https:; object-src 'none';"
    );
  } else {
    // 通常ルート: 標準的なCSP
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https: fonts.googleapis.com; img-src 'self' data: https:; font-src 'self' data: https: fonts.gstatic.com; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; object-src 'none';"
    );
  }
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
 * XSS対策: 外部HTMLから危険な要素を削除（sanitize-htmlライブラリを使用）
 * プロキシの目的上、基本的なHTMLタグは許可するが、危険な要素は削除
 * @param html - サニタイズするHTML文字列
 * @returns サニタイズ済みのHTML文字列
 */
function sanitizeExternalHtml(html: string): string {
  return sanitizeHtml(html, {
    // 許可するタグ（基本的なHTMLタグのみ）
    allowedTags: false ,
    // 許可する属性
    allowedAttributes: false ,
    // 許可するURLスキーム（http/httpsのみ）
    allowedSchemes: ['http', 'https'],
    // 許可するURLスキーム（属性別）
    allowedSchemesByTag: {
      'a': ['http', 'https'],
      'img': ['http', 'https', 'data'],
    },
    // インラインスタイルを許可しない
    allowedStyles: {},
    // 危険なタグを削除
    disallowedTagsMode: 'discard',
    // 危険なタグを確実に削除
    exclusiveFilter: function(frame: { tag: string }) {
      // script, iframe, object, embedタグを確実に削除
      return ['script', 'iframe', 'object', 'embed'].includes(frame.tag);
    },
    // 警告をログを無効
    allowVulnerableTags: true,
  });
}

// HTMLに<base>と操作禁止のスタイル・スクリプトを注入
function injectLockOverlay(html: string, baseHref: string) {
  const headTag = /<head[^>]*>/i;
  const baseTag = `<base href="${baseHref}">`;
  return html.replace(headTag, (match) => `${match}\n${baseTag}`);
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
    const rawBody = await response.text();
    
    // XSS対策: 外部HTMLをサニタイズ
    const safeBody = sanitizeExternalHtml(rawBody);
    // XSS対策: サニタイズ済みのHTMLに<base>タグを注入（相対パスを解決するため）
    const finalBody = injectLockOverlay(safeBody, url);
    
    // Content-TypeがHTMLの場合のみ処理
    const contentType = response.headers.get("content-type") || "text/html";
    res.set("Content-Type", contentType);
    res.status(response.status);
    
    // XSS対策: サニタイズ済みのbodyを送信
    res.send(finalBody);
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
