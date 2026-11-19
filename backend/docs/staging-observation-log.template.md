# Mikage 移行観察ログ（テンプレート）

このファイルをコピーし、Staging rehearsal または Production post-cutover の1回の観察期間を記録する。実測値を書いた記録は非公開の運用記録として保管し、リポジトリへcommitしない。

## 記録ルール

- secret、token、password、個人情報、target URL/header、DB行の内容、Environment画面、実環境の完全URLは記録しない。
- HTTP確認はprobe IDとstatusだけを記録する。証跡はログ名、deploy ID、commit SHAなどの参照IDで示す。
- repoに合格基準がない数値（遅延、5xx許容数、行増分など）は推測せず `UNDECIDED` とする。ownerが基準を決めるまで総合判定をPASSにしない。
- `GET /health` の200はDB接続確認であり、migration verifierの成功やsourceとのデータ一致を意味しない。

## 観察メタデータ（1 runにつき1回）

| 項目 | 記録 |
| --- | --- |
| phase | `Staging rehearsal` / `Production post-cutover` |
| 観察ID | |
| T0（ISO 8601、timezone付き） | |
| 観察担当 / rollback判断者 | |
| Dokploy app、Git branch / commit | |
| `COMPOSE_PROFILES` | |
| Render release / Preview deploy参照 | |
| 観察開始前の完了工程 | staging: runbook step 1–9 / production: cutover step 1–6 |
| 証跡の保管先（非公開） | |

## 共通の判定基準

- 各項目は `PASS` / `FAIL` / `UNDECIDED` / `N/A` で記録する。期待どおりの `watch-scheduler absent` と、観察期間内に実行予定がないmaintenance jobは `N/A`。
- Compose serviceは期待するserviceが `healthy` ならPASS。API `/health` は200かつ `status=ok` を期待する。migration stateは別に記録する。
- watch有効時はscheduler health JSONが `status=ok` で、`lastStatus=succeeded`、`lastSuccessAt` が3分以内であることを確認する。起動後3分以内の猶予はscheduler実装に従う。profile無効時はservice absentが期待状態。
- maintenance health JSONが `status=ok` であること。観察期間にJST毎月1日03:00 prune、03:05 logs reindex、03:07 incidents reindexのdueを跨ぐ場合だけ、そのjobの `jobSuccessAt` がdue以降であることを確認する。dueを跨がないjobはN/A。
- HTTP probeは下の契約に合えばPASS。Gateway staging routeがない場合の404は隔離経路未完了としてFAIL。
- migration gateは、観察開始前にverifierが成功し、 `data_verified=true` かつ `verified_at` があることを確認する。Productionでは同一snapshotのpreflight/import/verify、期間別集計、sequence/FK照合を別証跡で確認する。
- request failure数やDB増分は毎回記録する。repoで閾値が決まっていない項目はUNDECIDEDであり、数値を記録しただけではPASSにしない。

## HTTP probe契約（statusのみ）

| probe ID | 確認 | 期待 |
| --- | --- | --- |
| `health` | `GET /health` | 200 + `status=ok`（DB不可なら503/degraded） |
| `view-unauth` | 既知View route、Bearerなし | 401 |
| `view-auth` | 既知View route、正しい環境専用Bearer | migration gate開放後200、閉鎖中503 |
| `gateway-unauth` | 既知Gateway read route、Bearerなし | 401（Staging route未設置時の404はFAIL） |
| `admin-public` | 公開Gateway経由のadmin path | 404または到達不可 |

対象route名とstatusだけを記録し、token、response body、完全URLは記録しない。Render Viewの判定範囲は少なくともtargets / logs / errors / incidents / revisionを含める。

## Checkpoint register

T0、15分、1時間、24時間、7日の各欄を埋める。DB欄はT0をbaselineとし、以後は直前checkpointとの差分も記録する。

| 時点 | 観測時刻 | commit / deploy参照 | profiles | postgres / api / maintenance / watch health | migration gate (`data_verified` / `verified_at`) | HTTP probes（health / view unauth / view auth / gateway unauth / admin） | maintenance JSON要約（status / lastStatus / lastJob / jobSuccessAt・due） | watch JSON要約（status / lastStatus / lastSuccessAt / lastHttpStatus） | watch failed ticks / probe失敗 / その他5xx | DB count・日時・delta | View status（targets / logs / errors / incidents / revision） | notification mock・failure注入要約 | 証跡参照 | overall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T0 | | | | | | | | | | baseline | | | | |
| 15m | | | | | | | | | | | | | | |
| 1h | | | | | | | | | | | | | | |
| 24h | | | | | | | | | | | | | | |
| 7d | | | | | | | | | | | | | | |

DB集計はrunbook「保持範囲の独立照合SQL」の4表count、logs/incidentsのoldest/newest、watch_target_statesのlatest reservation/check時刻を記録する。行データは記録しない。

### Sourceとの件数の扱い

- **Staging**: 本番Render/GAS/Supabase cronを停止しないためsourceは変化する。sourceとの件数一致は要求せず、Staging destinationの観測値とdeltaのみ記録する。
- **Production post-cutover**: writer停止後に同一snapshotでmigration verifier・期間別件数・sequence・FKを照合した記録が切替gate。観察中のDB deltaはdrift確認用で、snapshot verifierの代わりにしない。

### Checkpoint overall

全ての必須項目がPASSで、N/Aが上記の期待状態に該当する場合だけPASS。一つでもFAILならFAIL。owner基準待ち・証跡不足・未実施が残る場合はUNDECIDED。その他5xx、遅延、行増分のSLAはownerが別途定義する。

## Failure injection 別記録（Staging必須）

| 時点 | mode | 期待挙動 | 実測要約（secretなし） | DB pending/read-back | 証跡参照 | 判定 |
| --- | --- | --- | --- | --- | --- | --- |
| | `api_failure` | 通知API失敗後、DB update前に失敗 | | | | |
| | `after_notification_before_db` | mock通知後、DB update前に503相当で中断 | | | | |
| | mode解除後 | pending再試行が収束し、通知重複は許容方針内 | | | | |

Failure injectionのoverall: `PASS` / `FAIL` / `UNDECIDED`（試験を行った別証跡を参照）。このmodeはアプリケーション処理を中断する試験であり、プロセスkillの再現ではない。

## 7日ゲート

| 条件 | 判定 / 証跡 |
| --- | --- |
| T0、15m、1h、24h、7dのoverallが全てPASS | |
| Failure injection別記録がPASS | |
| dueを跨いだmaintenance jobがPASS（跨がないjobはN/A） | |
| ownerの完了確認（署名・日時） | |
| 7日ゲートoverall | PASS / FAIL / UNDECIDED |

Staging 7日ゲートがPASSになるまで本番切替に進まない。Productionでは観察開始前の同一snapshot verifier合格と、runbookの停止・切替手順を別途満たす。
