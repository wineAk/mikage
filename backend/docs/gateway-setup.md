# Mikage Gateway 経路

## 経路

Render clientは `MIKAGE_GATEWAY_BASE_URL` に設定したGatewayへ、route prefixとsourceを付けて要求します。Productionでは `MIKAGE_GATEWAY_ROUTE_PREFIX` の既定値 `office/mikage` を使います。CloudFront経由でRackNerdまたはGreenCloudのCaddyへ到達し、Caddyは共通routeでprefixを `/gw/` に置き換えてProduction APIへ転送します。pathの残りとquery stringはそのまま維持し、`X-Origin-Verify` はCaddyからAPIへ渡しません。

Render PR PreviewをStagingへ隔離するときは、Previewだけで `MIKAGE_GATEWAY_ROUTE_PREFIX=office/mikage-staging` を明示し、`MIKAGE_API_BEARER_TOKEN`にはStaging API専用値を設定します。`IS_PULL_REQUEST=true` のPreviewではView/monitoringを含むすべてのGateway読み書きがStaging prefixを明示するまでfail closedし、未設定時にProduction prefixへ既定フォールバックしません。両VPSのCaddyには `/office/mikage-staging/` を `/gw/` に置き換え、Dokploy StagingのAPI service domainへ転送する共通routeが必要です。Production prefixとupstreamは変更しません。source名のallowlistは引き続きAPIだけが持ちます。

CaddyにはMikage個別のsource/path allowlistを置きません。公開できるoperationはAPIが持つ `/gw` routeだけです。APIがrouteを持たないpathや誤methodは404になります。`/admin`、`/admin.js`、`/v1/admin/*` はCaddyから転送されても `/gw` namespace内では定義されないため到達できません。

N094 APIへのupstreamは `https://mikage.inter.dedyn.io` です。VPSからは既存のACLで許可されたsubnet routeを通ります。ACL、Firewall、NAT、DNS、CloudFrontは変更しません。HTTPS証明書検証を維持します。

## 公開するAPI route

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

APIの `/gw` dispatchはこれらのmethod/pathだけを既存API routerへ内部rewriteします。query stringとPOST bodyを維持し、既存処理・validation・idempotencyを再利用します。全routeで既存の `Authorization: Bearer` 認証を要求し、未認証は401、未定義pathと誤methodは404です。APIのJSON body上限は1 MBです。`/gw` のdot segment、percent-encoded dot segment、encoded prefixも拒否し、namespace外のrouteへdispatchしません。

## CloudFrontとログ

Production Renderの `MIKAGE_GATEWAY_BASE_URL` は `https://gw.inter.dedyn.io` のままです。Previewも同じGateway hostを使い、`MIKAGE_GATEWAY_ROUTE_PREFIX` だけをStaging用prefixへ切り替えます。route prefixは `office/mikage` と `office/mikage-staging` の2値に限定し、任意URL pathは受け付けません。

CloudFront設定はこの変更の対象外です。運用確認ではGateway behaviorが既存origin group/failoverを使うこと、Authorizationをoriginへforwardすること、query stringをforwardすること、cacheを無効化すること、POSTを許可することを読み取り確認します。standard/realtime logにAuthorizationやorigin verification secretが記録されないことも確認してください。外部から401/404を見るだけではpolicy、cache、logging設定の証明にはなりません。

Caddyでは既存のCloudFront origin検証と最小監査ログを維持します。Bearer tokenとorigin verification secretをURL、ログ、応答に出しません。

## 確認

ローカル契約確認:

```bash
node --test backend/docs/gateway-contract.test.mjs
```

API routing/auth/body size/path traversal test:

```bash
cd backend/api
npm test
```

2026-11-19の実環境確認では、N094 API healthとBearer付きGETが200、Render PR Previewの `GET /api/v1/targets` が200（19件）、`/`・`/incidents`・`/errors` が200になった。Render経由のPOST保存/read-back、CloudFrontのAuthorization/query/cache/logging設定、LAN/WAN到達境界は未確認であり、コードテストやGETの成功だけでは証明できない。
