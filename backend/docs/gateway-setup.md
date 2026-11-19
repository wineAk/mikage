# Mikage Gateway 経路

## 経路と責任範囲

Render は `MIKAGE_GATEWAY_BASE_URL` の origin root に `/office/<アプリ名>/<source>` を付けて要求します。`MIKAGE_GATEWAY_BASE_URL` は root URL のみを受け付け、path付きURLは設定エラーです。アプリ名は `MIKAGE_GATEWAY_APP` で指定し、未設定時は `mikage` を使います。文字は `[a-z0-9-]+` に限定し、PR Previewでは `mikage-staging` の明示が必要です。

両VPSのCaddyはpathで転送先を選び、次の2経路を共通処理で転送します。pathのsourceとquery、POST bodyを保ち、`X-Origin-Verify` はupstreamへ渡しません。

| Render request | API upstream |
|---|---|
| `/office/mikage/<source>` | `https://mikage.inter.dedyn.io/gw/<source>`（Production） |
| `/office/mikage-staging/<source>` | `https://mikage-staging.inter.dedyn.io/gw/<source>`（Staging） |

CaddyはBearerやheaderの値を使って転送先を選ばず、Mikage固有のsource/path allowlistも持ちません。APIが `/gw` 配下の公開route、method、Bearer認証を管理し、未定義のpathや誤methodは404にします。`/admin`、`/admin.js`、`/v1/admin/*` は `/gw` namespaceに公開しません。ProductionとStagingは同じ環境変数名 `MIKAGE_API_BEARER_TOKEN` を使いますが、値は別々に発行・設定し、他方のAPIでは401になるようにします。tokenの文字列形式や接頭辞にrouting上の意味はありません。

Caddyfileの変更はClaudeが行います。アプリの変更に合わせてCaddy設定が必要になった場合は、Caddyfileを直接変更せず、Claudeへの作業依頼としてまとめます。VPS、Dokploy、Render、CloudFront、DNS、ACL、Firewall、NATの設定変更はこのアプリ作業に含めません。

## Render環境変数

Production Renderでは `MIKAGE_GATEWAY_BASE_URL` にGateway origin rootを設定し、`MIKAGE_GATEWAY_APP` は未設定（既定値 `mikage`）にします。Previewでは同じorigin rootを使い、`MIKAGE_GATEWAY_APP=mikage-staging` とStaging API専用の `MIKAGE_API_BEARER_TOKEN` を設定します。PR PreviewはStaging appが未設定または別の値ならGateway requestを送らずfail closedします。`MIKAGE_API_BEARER_TOKEN` はserver-only変数とし、`VITE_` prefixを付けません。

PreviewはStaging API/DBだけに接続させ、ProductionのSupabase接続値や実通知先を残しません。Render DashboardのPR Preview serviceのEnvironment Settingsを開き、Key/Valueを一行ずつ確認します。下記の本番接続・通知用変数をPreviewから削除し、必要なStaging用値へ置き換え、保存後にPreview serviceだけを再deployします。値は文書、commit、logへ記録しません。

- Supabase: `DATABASE_URL`、`SUPABASE_SECRET_KEY`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`
- Instatus: `VITE_INSTATUS_API_KEY`、`VITE_INSTATUS_SAASKE_PAGE_ID`、`VITE_INSTATUS_WORKS_PAGE_ID`、`VITE_INSTATUS_SAASKE_COMPONENT_SAASKE`、`VITE_INSTATUS_SAASKE_COMPONENT_API`、`VITE_INSTATUS_SAASKE_COMPONENT_WEBFORM`、`VITE_INSTATUS_SAASKE_COMPONENT_WEBTRACKING`、`VITE_INSTATUS_WORKS_COMPONENT_WORKS`
- Google Chat: `VITE_GOOGLE_WEBHOOK_URL`

Previewは `MIKAGE_PREVIEW_WATCH_ENABLED` が未設定または `false` の間、watchを実行しません。watchを明示的に試す場合も `MIKAGE_PREVIEW_NOTIFICATION_MOCK=true` が必要で、PreviewからInstatus/Google Chatへの外部通知は常に抑止します。PreviewではProduction用のSupabase、Instatus、Google Chat設定を使わないでください。

## API route contract

| Gateway method / path | 既存API | 用途 |
|---|---|---|
| `GET /gw/watch-targets` | `GET /v1/monitoring/targets` | 有効な監視対象を取得 |
| `POST /gw/watch-reservations` | `POST /v1/watch/reservations` | 監視slotを予約 |
| `POST /gw/watch-results` | `POST /v1/watch/results` | 監視結果を保存 |
| `GET /gw/watch-state` | `GET /v1/watch/state` | 監視状態とactive incidentを取得 |
| `POST /gw/watch-incidents` | `POST /v1/watch/incidents` | incident状態を更新 |
| `GET /gw/view-targets` | `GET /v1/view/targets` | View対象一覧を取得 |
| `GET /gw/view-target-proxy` | `GET /v1/view/target-proxy` | View用target情報を取得 |
| `GET /gw/view-logs` | `GET /v1/view/logs` | 監視ログを取得 |
| `GET /gw/view-errors` | `GET /v1/view/errors` | エラー履歴を取得 |
| `GET /gw/view-incidents` | `GET /v1/view/incidents` | incident履歴を取得 |
| `GET /gw/view-revision` | `GET /v1/view/revision` | View更新revisionを取得 |

APIの `/gw` dispatchは上記method/pathだけを既存handlerへ内部rewriteし、query stringとPOST bodyを維持します。すべてのrouteでBearer認証が必要です。未認証は401、未定義path・誤method・namespace traversalは404です。POST body上限は1 MBです。Bearerはresponse、error output、application logに出しません。

## CloudFrontとログ

CloudFront設定はこのアプリ変更の対象外です。運用確認時にはGateway behaviorのorigin/failover、Authorizationとqueryのforward、cache無効化、POST許可、標準/リアルタイムログにAuthorizationが記録されないことを読み取り確認します。外部から401/404を見るだけではCloudFrontのpolicy、cache、logging設定の証明になりません。

Caddy側のCloudFront origin検証と最小監査ログを維持します。Bearerとorigin verification secretをURL、ログ、応答へ出しません。

## ローカル確認

```bash
node --test backend/docs/gateway-contract.test.mjs
cd backend/api
npm test
```

コードテストは実サービスの環境変数、CloudFront設定、Caddy設定、LAN/WAN到達性、Production data migrationを証明しません。deploy後の疎通確認とProduction切替は別の手順で行います。
