# 監視 API 契約（実装中）

本ドキュメントは専用 Compose app 内のAPI endpointを記述する。Render View readsとwatch routeはGateway API clientへ切替済みで、watch/maintenance schedulerもCompose serviceとして実装済み。Supabase staging snapshotのimportと独立verifierは完了した。VPS Caddyは共通routeで `/office/mikage/*` を `/gw/*` へ転送する設定に変更されたとユーザーから報告があった。APIの `/gw` routeはfeature branchへ追加済みだが、Dokployへはまだdeployしていないため、Gateway実通信、POST保存、CloudFront policy/cache/logging、通知運用、本番データ移行とscheduler切替は未確認・未完了。

## 認証

- View/monitoring APIは `Authorization: Bearer <MIKAGE_API_BEARER_TOKEN>` を必須とする。`/admin` と `/v1/admin/*` は意図的に未認証で、LAN専用service domainとネットワーク境界に依存する。`GET /health` は認証不要。
- トークン不一致・未設定は `401` を返す。

## `GET /health`

- 認証不要。
- 成功: `200` と `{ "status": "ok" }`
- DB 接続不可: `503` と `{ "status": "degraded", ... }`
- migration data verification gateの状態とは独立してDB接続だけを確認する。ここが `200` でも、検証完了前の業務APIが利用可能とは限らない。

検証完了前は `/health` を除く全API routeが `503` を返す。healthcheckはDB接続確認に使い、アプリケーションデータの検証完了は別のmigration gateで制御する。

## `GET /v1/monitoring/targets`

監視実行（Render）専用。有効な target のみ返す。

- 成功: `200`
```json
{
  "targets": [
    {
      "key": "example",
      "name": "Example",
      "url": "https://example.invalid",
      "headers": null
    }
  ]
}
```

- `is_enabled = false` の行は含めない。

## `POST /v1/watch/reservations`

UTC 分スロットの予約。有効 target を DB から取得し、`mikage.reserve_watch_run` を呼び出す。

### リクエスト

```json
{
  "slot_start": "2026-11-16T10:35:00.000Z",
  "is_full_run": false
}
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `slot_start` | string (ISO 8601) | はい | 存在するUTC時刻の分境界（秒・ミリ秒は0） |
| `is_full_run` | boolean | はい | 全対象予約か輪番か |

### レスポンス

成功: `200`

```json
{
  "slot_start": "2026-11-16T10:35:00.000Z",
  "is_full_run": false,
  "selected_target_keys": ["alpha"],
  "reserved": true,
  "reason": "reserved"
}
```

同一または過去スロットの再予約でロック更新に失敗した場合:

```json
{
  "slot_start": "...",
  "is_full_run": false,
  "selected_target_keys": [],
  "reserved": false,
  "reason": "slot_already_reserved"
}
```

同一slotを再試行した場合、結果保存前なら同じtarget keyを返す。結果保存後なら同じtarget keyと保存済み`results`を返し、Renderはtargetへ再接続せず通知・incident更新を再開する。`selected_target_names`はこの復旧処理用のkey/name対応表。

### エラー

| 状況 | ステータス |
|---|---|
| 本文不正 | `400` |
| 監視対象数超過 | `413` |
| 有効 target なし | `503` |

## `POST /v1/watch/results`

予約slotの監視ログと状態を同一DB transactionで保存する。本文全体のSHA-256をslotごとに記録し、同じ内容の再送は副作用なしで `200 duplicate=true`、異なる内容の再送は `409` を返す。結果に含まれる全targetが該当slotで予約済みである必要がある。

### リクエスト

```json
{
  "slot_start": "2026-11-16T10:35:00.000Z",
  "results": [
    {
      "target_key": "alpha",
      "created_at": "2026-11-16T10:35:02.000Z",
      "response_time": 120,
      "status_code": 200,
      "status_message": "OK",
      "error_name": null,
      "error_code": null
    }
  ]
}
```

### 応答

- 新規保存: `201 { "saved": true, "duplicate": false, "slot_start": "..." }`
- 同じ内容の再送: `200 { "saved": true, "duplicate": true, "slot_start": "..." }`
- 未予約targetまたは同slotの異なる結果: `409`
- shape、型、件数不正: `400`


`results` は予約slotのtarget全件を一意に含める。輪番では予約済み1件、full-runでは全有効targetを含め、部分POSTは拒否する。APIはログからwatch failure state（初回失敗、5分経過後の確認、成功時のクリア）を計算し、Renderからのstate値を受け取らない。ログの `response_time` はinteger列に合わせて四捨五入する。最大件数は `MAX_TARGET_KEYS`（既定値500）。このendpointはincident通知/保存を行わない。障害通知は引き続きRenderが担当し、incident DB遷移は `POST /v1/watch/incidents` を使う。Render routeはAPI clientへ切替済み、実Gateway/private hopは未検証。

## Incident state API

- `GET /v1/watch/state`：監視専用Bearer endpoint。全 `watch_target_states` と `is_closed IS NULL` のactive incidentsを返し、Renderのサービス別障害判定に使う。
- `POST /v1/watch/incidents`：Bearer認証。`operation` は `open` / `notification_pending` / `update` / `close`。各操作に安定した`request_id`、keyword、ISO `now` を渡す。openではcount=1、`notification_pending`ではincident_idを指定して外部通知前に再送対象を記録する。updateではincident_id/count/外部通知IDを渡して通知後の状態を確定し、closeではincident_idを渡す。外部通知が成功した後にRenderが停止してDB保存まで届かなかった場合、未確定のDB状態から次の監視tickで再通知し、重複を許容する。pending記録後に外部通知APIが失敗した場合はpendingが残るため次tickで再試行する。通知の重複/欠落を含むstate収束はstagingのfailure injectionで確認する。
- request_idとcanonical request hashをDB保存する。同じIDと同じbodyは200 duplicateで元incident_idを返し、異なるbodyは409。
- openは同じkeywordの未解決incidentがあれば409。update/closeは指定id/keywordの未解決incidentだけを更新する。DB更新と冪等性recordは同じtransaction。

このAPIは通知を送らない。Instatus/Google Chatの送信・interval判断はRenderに残す。Render routeはAPI clientへ切替済みだが、実Gateway接続は未検証。

Render PR Preview（`IS_PULL_REQUEST=true`）では`MIKAGE_PREVIEW_WATCH_ENABLED=true`がない限りwatch routeを503で停止する。有効化後もInstatus/Google Chatへの外部通知を抑止し、監視結果とincident stateだけをDokploy APIへ保存する。Preview環境のDB接続先をstaging DBに設定してからwatchを有効にする。通常Render serviceでは既存動作を維持する。

## View read API

すべてBearer認証が必要。

- `GET /v1/view/targets` → `{ "targets": [{ "key", "name" }] }`。無効targetも含み、接続先URL/headersは返さない。
- `GET /v1/view/target-proxy?key=<key>` → `{ "target": { "name", "url", "headers" } | null }`。Renderの既存`/:key`外部ページproxyだけが使うserver-to-server endpoint。Bearer必須、`private, no-store`、targetがなければnull。URLのhostnameが既存preview許可hostとHTTPS条件に完全一致しないtargetはnullを返す。DB接続先情報をbrowserへ渡さない。
- `GET /v1/view/logs?keys=<comma-separated>&start=<ISO>&end=<ISO>` → `{ "data": [{ "key", "name", "logs": [...] }] }`。現行RPCの期間別bucket幅、平均response時間、status/error集約を実装している。
- `GET /v1/view/errors?offset=<0..120>` → `{ "data": { "previous_month_count", "next_month_count", "logs": [...] } }`。JST月境界、NO_INTERNET除外、created_at降順/name昇順。
- `GET /v1/view/incidents?offset=<0..120>` → `{ "data": [...] }`。JST月範囲、created_at昇順。
- `GET /v1/view/revision` → `{ "revision": "<epoch>:<revision>" }`。PostgreSQL起動時刻と変更counterを使い、logs/targets/incidents更新で変化する。

View read endpointsのSQL/API testsは専用PostgreSQL 17のfresh clusterで検証した。Render loader/actionとの同一データ比較と実Gateway通信は未実施。

## Target管理画面/API

`GET /admin` はHTML、`GET /admin.js` は同画面scriptを返す。画面は同originの次のAPIを使う。ログイン認証は設けないが、すべてのadmin routeは `MIKAGE_ADMIN_ALLOWED_HOSTS` に完全一致したHostだけ応答し、未設定ではAPIを起動しない。本番ではLAN内のDokploy service domainだけを指定する。Host制限に加えてN094のFW/NAT境界も必要。

- `GET /v1/admin/targets`：全target（管理画面専用のurl/headersを含む）。`Cache-Control: private, no-store`。
- `POST /v1/admin/targets`：`key`, `name`, `url`, `headers` を作成
- `PUT /v1/admin/targets/:key`：`name`, `url`, `headers` を更新。keyは不変
- `PATCH /v1/admin/targets/:key/enabled`：`{ "is_enabled": boolean }` で無効化/再有効化。hard deleteなし

HTTPS URL、資格情報/fragmentなし、完全一致target host allowlist、HTTP header名/value/合計長を検証する。監査表には操作と変更field名のみ記録しURL/header値は保存しない。公開Caddy/Gateway経路から管理routeを遮断し、LAN以外から到達できないことがdeploy gate。

監視APIもenabled target全件のURL/headersを同じ制約で検査し、1件でも不正ならURL/header値を含めず503を返す。移行verifierはsource/destination両方のenabled target hostが `MIKAGE_TARGET_ALLOWED_HOSTS` に含まれることを切替前に確認する。disabled targetは予約/API結果から除外され、再有効化時にadmin APIがURL/headersを再検証する。View preview proxyはHTTPS、URL長、headers形式、個別の既存許可host群との完全一致を検査する。

## Gateway API

Render serverは `MIKAGE_GATEWAY_BASE_URL` に `https://gw.inter.dedyn.io` を設定し、`MIKAGE_API_BEARER_TOKEN` をAuthorization headerへ設定して `/office/mikage/<source>` を呼ぶ。VPS Caddyの共通routeはprefixを `/gw/` に置き換えて `https://mikage.inter.dedyn.io` へ転送する。Caddyで個別source/pathの許可一覧は持たず、APIが公開routeを限定する。`X-Origin-Verify` はCaddyからAPIへ転送しない。watch起動endpoint `/api/v1/watch` は別tokenを `Authorization: Bearer ...` headerで受け取る。query `key` は廃止したため、既存GAS triggerの切替はschedulerの本番化まで行わない。

| Render source | method | Gateway API path | 既存handler |
|---|---|---|---|
| `watch-targets` | GET | `/gw/watch-targets` | `/v1/monitoring/targets` |
| `watch-reservations` | POST | `/gw/watch-reservations` | `/v1/watch/reservations` |
| `watch-results` | POST | `/gw/watch-results` | `/v1/watch/results` |
| `watch-state` | GET | `/gw/watch-state` | `/v1/watch/state` |
| `watch-incidents` | POST | `/gw/watch-incidents` | `/v1/watch/incidents` |
| `view-targets` | GET | `/gw/view-targets` | `/v1/view/targets` |
| `view-target-proxy` | GET | `/gw/view-target-proxy` | `/v1/view/target-proxy` |
| `view-logs` | GET | `/gw/view-logs` | `/v1/view/logs` |
| `view-errors` | GET | `/gw/view-errors` | `/v1/view/errors` |
| `view-incidents` | GET | `/gw/view-incidents` | `/v1/view/incidents` |
| `view-revision` | GET | `/gw/view-revision` | `/v1/view/revision` |

APIは `/gw` の上記method/pathを既存handlerへ内部dispatchし、既存の認証・validation・DB処理を再利用する。query stringとrequest bodyを保持する。未認証は401、未定義pathと誤methodは404。JSON request bodyは1 MBを上限とする。dot segmentとpercent-encoded dot segmentを含むGateway pathは404となり、Gateway namespace外へdispatchしない。管理routeは `/gw` route tableへ登録せず、`/admin`、`/admin.js`、`/v1/admin/*` は公開Gatewayから利用できない。

この変更はfeature branchのAPI code/docだけで、Dokploy/VPS/CloudFront/Renderの設定は変更しない。Dokploy deploy後のBearer付きGateway通信、POST保存/read-back、CloudFront policy/cache/logging、N094 public-ingress boundaryは別途実環境確認が必要。本番Supabase dump/load/sequence reconciliation、scheduler cutover、観察期間も未完了。Supabase staging snapshotはDokploy DBへimportされ、独立検証済み。

Compose `watch-scheduler` is isolated by the `watch` profile; the local override does not control whether the service is included. Enable the profile only after the GAS/Render cutover is approved, and set `WATCH_SCHEDULER_ENABLED=true` plus its Render URL/token in the Dokploy service environment. It calls Render `/api/v1/watch` every minute using a Bearer header and has no database credentials or network access. `maintenance-scheduler` starts with the default Compose services, uses its dedicated role to prune logs/incidents at JST month start 03:00 according to event time, and idempotency batches according to `saved_at`; it reindexes logs/incidents concurrently at 03:05/03:07. Each maintenance job checks the migration verification gate before running. Scheduler state is stored in service-specific named volumes. Watch health becomes degraded after three minutes without success; maintenance health becomes degraded 15 minutes after a scheduled job remains unsuccessful. Missed work does not catch up after a restart. Dokploy health alert routing and notification destinations remain unconfigured.

Earlier PostgreSQL 17.11 verification on 2026-11-17: fresh DB applied migrations 001–014; API PostgreSQL integration tests passed 27/27; scheduler/maintenance integration tests passed 19/19; migration verifier/Gateway contract tests passed 35/35. In the later DB-free run, API tests passed 5 cases with 23 database integration cases skipped, scheduler tests passed 17 with 2 DB cases skipped, migration verifier/Gateway tests passed 17/17, and Render watch/Gateway focused tests were run separately. Docker Compose service startup/health and the real network path remain unverified because the Docker engine and staging environment were unavailable.

Incident schema parity verification on 2026-11-18: an isolated PostgreSQL 17 cluster applied migrations 001–015 and returned the expected `information_schema.columns.column_default` expressions for `incidents.keyword` and `incidents.count`; the temporary cluster was removed. N094 has migration 015 applied. Its read-only preflight found matching shared column attributes/defaults but a different physical order for `incidents.googlechat_name` and `instatus_id`. A separate read-only `information_schema.columns` check on N094 confirmed destination definitions `targets.is_enabled` = boolean / NOT NULL / default `true` / not identity, and `incidents.notification_pending` = boolean / NOT NULL / default `false` / not identity; the Supabase schema query returned neither destination-only column. The comparator now sorts contract columns by name, checks shared column attributes strictly, validates those destination-only definitions against their migrations, and compares `targets.is_enabled` when present in the source.




