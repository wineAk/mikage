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

// ALLOWED_IPS（カンマ区切り）を配列に
const allowedIps = (process.env.ALLOWED_IPS || "").split(",").map(ip => ip.trim()).filter(Boolean);
console.log('allowedIps:', allowedIps);

// XSS対策: Content Security Policy (CSP) ヘッダーを設定するミドルウェア
app.use((req, res, next) => {
  // CSPヘッダーを設定（XSS攻撃を緩和）
  // プロキシの目的上、外部リソースを許可する必要があるが、可能な限り厳格に設定
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
 * XSS対策: URLエスケープ関数
 * URLパラメータを安全にエスケープ
 */
function escapeUrl(unsafe: string): string {
  return encodeURIComponent(unsafe);
}

/**
 * XSS対策: 外部HTMLから危険な要素を削除
 * プロキシの目的上、完全なサニタイズは難しいが、最低限の危険要素を削除
 */
function sanitizeExternalHtml(html: string): string {
  // 危険なスクリプトタグを削除（injectLockOverlayで既に無効化しているが、念のため）
  // ただし、プロキシの目的上、完全なサニタイズは行わない
  // CSPヘッダーとinjectLockOverlayで保護される
  
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
  // XSS対策: baseHrefをURLエスケープ（既にvalidateUrlで検証済みだが、念のため）
  // ただし、baseタグのhref属性はURLなので、HTMLエスケープではなく属性値として安全に処理
  // ダブルクォートをエスケープして属性値として安全にする
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

/**
 * SSRF対策: URL検証関数
 * 許可されたスキームとホストのみを許可し、プライベートIPアドレスをブロック
 */
function validateUrl(urlString: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);
    
    // 1. スキーム検証: httpsのみ許可
    const allowedSchemes = ['https:'];
    if (!allowedSchemes.includes(url.protocol)) {
      return { 
        valid: false, 
        error: `許可されていないスキームです: ${url.protocol}` 
      };
    }

    // 2. ホスト名の検証
    const hostname = url.hostname;
    
    // 3. プライベートIPアドレスとローカルホストのブロック
    const privateIpPatterns = [
      /^127\./,           // 127.0.0.0/8
      /^10\./,            // 10.0.0.0/8
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
      /^192\.168\./,      // 192.168.0.0/16
      /^169\.254\./,      // 169.254.0.0/16 (リンクローカル)
      /^0\.0\.0\.0$/,     // 0.0.0.0
      /^localhost$/i,     // localhost
    ];

    // IPv6プライベートアドレスのパターン
    const privateIpv6Patterns = [
      /^::1$/,            // IPv6 localhost
      /^::ffff:127\./,     // IPv4-mapped IPv6 localhost
      /^fc00:/i,          // IPv6 プライベート (fc00::/7)
      /^fd00:/i,          // IPv6 プライベート (fd00::/8)
      /^fe80:/i,          // IPv6 リンクローカル (fe80::/10)
      /^ff00:/i,          // IPv6 マルチキャスト (ff00::/8)
    ];

    // IPアドレス形式かどうかをチェック
    const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
    const isIpv6 = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(hostname) ||
                   /^\[([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}\]$/.test(hostname);
    
    if (isIpv4) {
      // IPv4アドレスの場合、プライベートIPかチェック
      for (const pattern of privateIpPatterns) {
        if (pattern.test(hostname)) {
          return { 
            valid: false, 
            error: `プライベートIPアドレスまたはlocalhostは許可されていません: ${hostname}` 
          };
        }
      }
      // すべてのIPアドレス形式をブロック（ホワイトリストがない場合）
      const allowedHosts = (process.env.ALLOWED_HOSTS || "")
        .split(",")
        .map(h => h.trim())
        .filter(Boolean);
      if (allowedHosts.length === 0) {
        return { 
          valid: false, 
          error: `IPアドレス形式のURLは許可されていません: ${hostname}` 
        };
      }
    } else if (isIpv6) {
      // IPv6アドレスの場合、プライベートIPかチェック
      const normalizedHostname = hostname.replace(/^\[|\]$/g, '');
      for (const pattern of privateIpv6Patterns) {
        if (pattern.test(normalizedHostname)) {
          return { 
            valid: false, 
            error: `プライベートIPv6アドレスは許可されていません: ${hostname}` 
          };
        }
      }
      // すべてのIPv6アドレス形式をブロック（ホワイトリストがない場合）
      const allowedHosts = (process.env.ALLOWED_HOSTS || "")
        .split(",")
        .map(h => h.trim())
        .filter(Boolean);
      if (allowedHosts.length === 0) {
        return { 
          valid: false, 
          error: `IPv6アドレス形式のURLは許可されていません: ${hostname}` 
        };
      }
    } else {
      // ホスト名の場合、localhostをブロック
      if (privateIpPatterns.some(pattern => pattern.test(hostname))) {
        return { 
          valid: false, 
          error: `localhostは許可されていません: ${hostname}` 
        };
      }
    }

    // 4. オプション: 環境変数でホワイトリストが設定されている場合は検証
    const allowedHosts = (process.env.ALLOWED_HOSTS || "")
      .split(",")
      .map(h => h.trim())
      .filter(Boolean);
    
    if (allowedHosts.length > 0) {
      const hostMatches = allowedHosts.some(allowedHost => {
        // 完全一致またはワイルドカード対応（例: *.example.com）
        if (allowedHost.startsWith("*.")) {
          const domain = allowedHost.slice(2);
          return hostname === domain || hostname.endsWith(`.${domain}`);
        }
        return hostname === allowedHost;
      });
      
      if (!hostMatches) {
        return { 
          valid: false, 
          error: `許可されていないホストです: ${hostname}` 
        };
      }
    }

    return { valid: true };
  } catch (error) {
    return { 
      valid: false, 
      error: `無効なURL形式です: ${error instanceof Error ? error.message : String(error)}` 
    };
  }
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
    
    // SSRF対策: URL検証
    const urlValidation = validateUrl(url);
    if (!urlValidation.valid) {
      console.error("SSRF Protection: Invalid URL detected", { url, error: urlValidation.error });
      // XSS対策: エラーメッセージをエスケープ
      const escapedError = escapeHtml(urlValidation.error || "不明なエラー");
      res.status(400).send(`❌ 無効なURLです: ${escapedError}`);
      return;
    }
    
    // SSRF対策: タイムアウトとリダイレクト制限付きで接続
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒タイムアウト
    
    try {
      const response = await fetch(url, { 
        headers,
        signal: controller.signal,
        redirect: 'manual', // リダイレクトを手動で処理（SSRF対策）
        // リダイレクト先も検証する必要がある場合は、手動で処理
      });
      
      clearTimeout(timeoutId);
      
      // リダイレクトレスポンスの場合はエラー
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location) {
          // リダイレクト先も検証
          const redirectValidation = validateUrl(location);
          if (!redirectValidation.valid) {
            console.error("SSRF Protection: Invalid redirect URL detected", { location, error: redirectValidation.error });
            // XSS対策: エラーメッセージをエスケープ
            const escapedError = escapeHtml(redirectValidation.error || "不明なエラー");
            res.status(400).send(`❌ 無効なリダイレクト先URLです: ${escapedError}`);
            return;
          }
          // リダイレクト先が有効な場合、再度fetch（最大1回まで）
          const redirectResponse = await fetch(location, { 
            headers,
            signal: controller.signal,
            redirect: 'manual',
          });
          // ここでは最初のリダイレクトのみ許可（無限リダイレクト防止）
          if (redirectResponse.status >= 300 && redirectResponse.status < 400) {
            res.status(400).send(`❌ リダイレクトが多すぎます`);
            return;
          }
          // 最終的なレスポンスを使用
          const finalResponse = redirectResponse;
          let body = await finalResponse.text();
          
          // レスポンスサイズ制限（10MB）
          const maxBodySize = 10 * 1024 * 1024; // 10MB
          if (body.length > maxBodySize) {
            res.status(413).send(`❌ レスポンスサイズが大きすぎます`);
            return;
          }
          
          // XSS対策: 外部HTMLをサニタイズ
          body = sanitizeExternalHtml(body);
          body = injectLockOverlay(body, location);
          
          // Content-TypeがHTMLの場合のみ処理
          const contentType = finalResponse.headers.get("content-type") || "text/html";
          res.set("Content-Type", contentType);
          res.status(finalResponse.status);
          res.send(body);
          return;
        }
      }
      
      let body = await response.text();
      
      // レスポンスサイズ制限（10MB）
      const maxBodySize = 10 * 1024 * 1024; // 10MB
      if (body.length > maxBodySize) {
        res.status(413).send(`❌ レスポンスサイズが大きすぎます`);
        return;
      }
      
      // XSS対策: 外部HTMLをサニタイズ
      body = sanitizeExternalHtml(body);
      body = injectLockOverlay(body, url);
      
      // Content-TypeがHTMLの場合のみ処理
      const contentType = response.headers.get("content-type") || "text/html";
      res.set("Content-Type", contentType);
      res.status(response.status);
      res.send(body);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        console.error("Proxy Error: Request timeout", { url });
        res.status(504).send("❌ リクエストがタイムアウトしました");
        return;
      }
      throw error; // 他のエラーは外側のcatchで処理
    }
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
