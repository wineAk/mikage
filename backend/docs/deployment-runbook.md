# Dokploy移行・運用手順

この手順は、Mikage専用Dokploy Compose appのstaging、Supabaseからのデータ移行、本番切替、切戻しを扱う。N094、Render、VPS Gateway、Supabaseの設定変更は、該当する工程の承認と前提確認が終わるまで行わない。

## 2026-11-19の現状確認（移行判定には使わない参考値）

2026-11-19 07:23–07:26 UTCにSupabase sourceとN094 Dokploy PostgreSQLを別々に読み取り、対象4表の件数を再確認した。sourceは稼働中で、2 DBの読み取りは同一transaction/snapshotではないため、本番移行の合格証跡には使わない。

| table | Supabase source | N094 Dokploy DB（service environment: production） | 差（destination - source） |
| --- | ---: | ---: | ---: |
| `targets` | 19 | 19 | 0 |
| `logs` | 409,005 | 388,522 | -20,483 |
| `incidents` | 1 | 1 | 0 |
| `watch_target_states` | 19 | 19 | 0 |

N094の`logs`件数はsourceより20,483件少なかった。source `logs`の観測範囲は`2026-09-30 15:00:27.947+00`〜`2026-11-19 07:23:27.3+00`、N094は`2026-09-30 15:00:27.947+00`〜`2026-11-17 15:51:26.216+00`。残る3表で件数が一致しても内容一致を示さない。Dokploy上の対象Compose appは`production`環境に属し、読み取り確認時点でAPI、PostgreSQL、maintenance schedulerが稼働中だった。DBの`migration_state.data_verified`も`true`だったが、これは現時点のsourceとの同一snapshot照合や本番切替準備の完了を示さない。既存DBをstaging用と決めつけず、既存volumeを保持し、新しいimport先として再利用・初期化しない。staging rehearsalと本番切替には、それぞれ既存DBと分離した専用の空DB/volumeを用意する。writer停止後の本番importでは、同一時点のschema、全行、期間別件数、sequence、FKをrunbookのmigration verifierと独立集計で照合する。

同日、専用Dokploy staging appへSupabase snapshotをimportし、`targets`、`logs`、`incidents`、`watch_target_states`の内容照合が成功した。これはimport時点のsnapshot照合であり、現在のSupabaseとの同期を示さない。staging API、PostgreSQL、maintenance schedulerはhealthyで、watch schedulerは停止中。`https://mikage-staging.inter.dedyn.io/health`は200、admin APIは200、未認証View APIは401を返した。Render PR Previewからstaging専用の一時targetを読み取る経路も確認し、試験後にそのtargetを無効化した。

Render PR Previewからのwatch実行/read-back、通知failure injection、独立staging DB上の7日観察は未実施。Preview用通知mock/failure injectionを含む `c52c457` はfeature branchへpush済みで、2026-11-19にRender PR Previewへ手動deployされ、`Deploy succeeded | Live` を確認した。deploy後、Preview rootと `GET /api/v1/targets` は200、未認証の `GET /api/v1/watch` は401だった。この確認はwatch実行やDB writeの証明ではない。N094 stagingのPostgreSQL、API、maintenance schedulerはhealthyだが、watch schedulerはまだ起動していない。PreviewからStagingへのwatch/read-back、failure injection、7日観察は未完了であり、本番切替の前提は満たしていない。

## 固定する運用境界

- Dokployでは専用Project内のMikage Compose appだけを操作する。Dokploy全体設定、他service、global schedule/jobは変更しない。
- Compose定義は `backend/compose/docker-compose.yml`、Git Compose pathも同じファイルを指定する。GitHub branchとcommitはdeployごとに記録し、Dokployから手動deployする。
- schedulerはCompose service内に置き、watch schedulerとmaintenance schedulerをそれぞれ1 replicaで動かす。Dokploy Schedule Jobやhost timerは追加しない。
- Postgres portはhostへ公開しない。Postgresのnamed volumeは `mikage_postgres_data` 専用とし、既存DBのvolumeと共有しない。統合テスト用は `mikage_postgres_test_api_data` と `mikage_postgres_test_maintenance_data` を本番 volume と別に保ち、test profile の Postgres は port / `dokploy-network` / 公開 Domain を持たない。
- Compose serviceのNetworksは対象Dokploy app内だけ設定する。Dokploy Domainsが必要な`api`のみ`dokploy-network`へ接続し、Postgres/migrate/scheduler/test/migration serviceは共有`dokploy-network`から外してCompose定義の専用networkだけに置く。既存serviceやDokploy全体networkの変更はしない。Dokploy v0.30以降に非推奨となったIsolated Deployments toggleは使わず、Advanced → Networksのservice単位Attach/Detachを使う。
- API serviceにだけLAN向けDokploy Domainを設定する。Domain/DNSとHost allowlistだけでは到達元を制限しない。ユーザーはN094非公開と既存VPS Caddy経路の通信成功を確認済み。Gateway upstreamは既存ACLで許可されたsubnet route経由の `https://mikage.inter.dedyn.io` とする。ACLや他のnetwork設定は変更しない。今回のdeploymentでは既存network設定に変更を加えず、新API serviceが既存経路経由で応答することと管理DomainがLAN内でだけ到達できることを検証する。admin画面/APIにログイン認証はないため、Domain設定後にLAN外と公開Gateway経路から到達しないことを確認する。Dokploy/Traefik全体設定や他serviceを変更して解決しない。
- Renderの `MIKAGE_GATEWAY_BASE_URL` はorigin root `https://gw.inter.dedyn.io` とする。`/office/mikage` はRender clientが付ける。API Bearer、watch execute token、DB passwordは用途ごとに別値を使い、service単位のsecretとして設定する。
- バックアップは作成しない。N094またはvolumeを失った場合、データを復元できない可能性がある。移行時のstream dumpはバックアップではなく一時転送として扱い、移行後に残さない。

## deploy前チェック

- [ ] branch、commit、Dokploy Project/app、Compose pathが意図したMikage専用のものと一致する。
- [ ] DokployのDomains tabでDomainは`api` serviceだけに割り当てる。Advanced → Networksの設定を次の表に合わせる。

  | Compose service | Compose network | `dokploy-network` |
  | --- | --- | --- |
  | `api` | `mikage_internal` | attach（Domain/Traefik用） |
  | `postgres`, `migrate`, `maintenance-scheduler`, `postgres-test-api`, `postgres-test-maintenance`, `migrate-test-api`, `migrate-test-maintenance`, `integration-tests`, `maintenance-integration-tests`, `migration-import`, `migration-preflight`, `migration-snapshot`, `migration-verify` | `mikage_internal` | detach |
  | `watch-scheduler` | `mikage_egress` | detach |

  Preview Composeと`docker network inspect`で、共有networkにはMikageの`api`以外が参加せず既存memberが変化していないことを確認する。Postgres・scheduler・test/migration serviceに公開Domain/host portがない。
- [ ] Production Dokploy appの `COMPOSE_PROFILES` は本番切替前は空欄にする。通常起動では`postgres`、`migrate`、`api`、`maintenance-scheduler`が起動し、`watch-scheduler`とmigration/test profile serviceは起動しない。本番の`watch` profileはGAS停止を確認してから切替承認に従って有効化する。独立したStaging appでは、Preview通知mockとStaging専用tokenを確認した後、リハーサルおよび観察のため`watch` profileを有効化してよい。
- DokployのEnvironment SettingsはKey/Value行を追加する画面ではなく、Compose用`.env`をまとめて編集する複数行欄。既存内容を置き換えず、必要な変数を `KEY=value` 形式で1変数につき1行追記する。secretを含む既存値は画面表示・ログ出力・リポジトリへの転記をしない。保存だけでは稼働中containerに反映されず、対象のMikage Staging serviceを手動deployした後に反映状態を確認する。
- [ ] `migration-verify`成功前も`/health`はDB接続を返し、それ以外の全routeが503で閉じることを確認する。health 200はmigration gate通過を意味しない。maintenance schedulerはAPI healthcheck成功後に起動し、各job直前にDB gateを再確認する。
- [ ] APIの `MIKAGE_ADMIN_ALLOWED_HOSTS` はLAN専用Domainのみ、`MIKAGE_TARGET_ALLOWED_HOSTS` は現在のenabled target hostを完全一致で含む。
- [ ] API Domain設定後、LAN内と既存VPS Caddyのsubnet routeから必要なAPI pathへ到達でき、LAN外と公開Gateway経路から管理画面/APIへ到達できないことを実測する。Caddy経由の未認証routeは401、admin pathは404との報告があるが、LAN外境界は別途実測する。ユーザーが確認した既存network pathや他serviceは変更しない。
- [ ] CloudFrontがAuthorizationをoriginへforwardし、queryを保持し、cacheを無効化している。standard/realtime logにAuthorizationが出ないことを確認する。GreenCloud/RackNerd両originでも確認する。
- [ ] targetのAPI key/Cookieなど既存認証値をローテーションし、staging用とproduction用の通知先を分離する。
- [ ] Production appの`watch-scheduler`は本番切替まで無効にし、GASとの同時起動を防ぐ停止・再開担当とタイミングを決める。独立Staging appは、通知mockと専用tokenの設定後に限り、staging rehearsal/観察用に有効化できる。
- [ ] healthcheckの失敗を誰が監視し、どこへ通知するかを設定する。Composeのhealth表示だけで監視完了とはみなさない。

一つでも満たさない場合、staging接続、migration import、scheduler有効化へ進まない。

## staging構築と移行リハーサル

1. 本番volumeと分離した空のstaging DB/appを用意し、GitHub feature branchをDokployから手動deployする。branch/commit、service状態、health、Domainを記録する。
2. 初回deployでは `COMPOSE_PROFILES` を空欄にして手動deployする。`postgres`と一回限りの`migrate`、`api`、`maintenance-scheduler`の状態を確認し、watch schedulerが起動していないこと、Postgres host portがなく、管理DomainからのアクセスがLAN内に限定されることを確認する。`/health`以外のAPI routeがmigration gateにより503で閉じることも確認する。
3. 監視起動、外部通知、Render staging接続を無効のままにし、通知をmockまたは安全なstaging通知先へ向ける。production Instatus/Google Chatへ送らない。
4. Supabase sourceのhost/port/database、TLS CA、read-only用一時credentialを用意する。sourceの現行schema、RLS、対象4表の行数・期間・sequenceを取得し、既存writerを特定する。
5. stagingでは本番Render writer、GAS、Supabase cronを停止しない。まず`docker compose --profile migration run --rm migration-preflight`を実行してschema-only照合を済ませる。Supabase sourceへの専用TLS接続を用意し、別terminalで`docker compose --profile snapshot run --rm -it migration-snapshot`を対話起動する。sourceセッションで次を入力し、出力されたsnapshot IDを記録する。

   ```sql
   BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
   SELECT pg_export_snapshot();
   ```

   psqlのトランザクションを開いたまま維持する。snapshot exporterを閉じるとsnapshot IDは失効するため、短時間にdumpとverifierを終える。長時間保持はVACUUMによるdead row回収を遅らせる。snapshot IDをmigration service環境の`MIKAGE_SOURCE_SNAPSHOT_ID`へ設定し、`MIKAGE_SOURCE_WRITES_FROZEN`は設定しない。snapshot IDは秘密値ではないが、完了後に環境から消す。Supabase Session Poolerは接続開始時の`PGOPTIONS`を反映しないため、importerは独立したsource接続で`BEGIN READ ONLY`を実行してread-only状態を確認する。PostgreSQL 17の`pg_dump --snapshot`もdump transactionを`REPEATABLE READ, READ ONLY`に設定してからsnapshotを適用する。
6. schema contractは列名で定義を対応付け、列の並び順は比較しない。共通列の型・nullable・default・identityなど列ごとの属性は厳密比較する。移行先専用の `targets.is_enabled` と `incidents.notification_pending` はmigration定義どおり存在し属性が一致することを別途検証し、Supabase側に `targets.is_enabled` がある場合はその属性も移行先と厳密比較する。`information_schema.columns.column_default` のcast・引用符の違いも不一致として止める。Supabaseの`incidents.keyword` / `count` defaultはmigration `015_incident_default_parity.sql`で揃える。015適用後のN094 preflightでは、`incidents.googlechat_name` と `instatus_id` の列順差だけが比較不一致として残った。比較器を列名単位に正規化する修正後、schema-only preflightを再実行し、成功するまでsnapshot/export/importへ進まない。空の移行先で`migration-import`を実行し、終了後に`migration-verify`を実行する。importerは完了済みpreflightとDBを依存先に持つ。verifierはimporterを依存先にしない（検証時に空DB専用importerをComposeが再起動しないようにするため）。このため実行順は手動で守り、両serviceに同じ`MIKAGE_SOURCE_SNAPSHOT_ID`を設定する。importerの`pg_dump --snapshot`とverifierのREPEATABLE READ transactionが同じexported snapshotを使うため、通常の監視書込みやcronが継続しても同一DB時点のtable rowsを比較できる。sequence値はMVCC snapshotに含まれず稼働中に進むため、staging verifierは移行先がsnapshot内の最大IDを再利用しないことを確認し、source/destinationのsequence完全一致は要求しない。本番切替はwriter停止モードで実行し、sequenceの完全一致を検証する。importer/verifierはsource接続roleがsuperuserまたは`BYPASSRLS`であることを確認する。verifierは対象4表のrow hash/count、identity sequence安全性、FK孤児、schema contractを照合し、全検査の成功後にだけmigration gateを開く。保持期間境界と重要集計は同じsnapshot時点のsourceとdestinationで別途照合する。不一致なら同じ移行先を再利用せず、空の専用DBからやり直す。検証後、snapshot psqlで`ROLLBACK;`してから`\q`で終了する。snapshot ID、一時source credential、CAをmigration環境から削除し、一時migration roleをSupabaseから撤去する。
7. schema-only preflight後、既定起動中のAPIで`/health`だけがDB接続を返し、それ以外のAPI routeが503で閉じることを確認する。import/verifier成功後に管理画面とretention/reindexを確認する。sourceとdestinationは別DBなのでSupabase cronを維持したままdestination maintenanceを検証できる。watch schedulerは`watch` profileに隔離し、Render staging endpointと安全な通知sinkを用意して明示確認するまで起動しない。
8. Render PR PreviewをStaging APIへ隔離し、View GET、watch結果POSTとread-back、重複予約、target管理、revision更新、API再起動、JST/祝日周期を検証する。Render Environment Settingsでは環境変数ごとにKey/Valueの行を作り、`Add variable`で追加する。Dokploy StagingのEnvironment Settingsは複数行`.env`欄なので、既存内容を保ったまま`KEY=value`を1変数につき1行で追記する。Previewだけに`MIKAGE_GATEWAY_ROUTE_PREFIX=office/mikage-staging`とStaging API専用の`MIKAGE_API_BEARER_TOKEN`を設定する。両VPSのCaddyにStaging prefixからStaging APIへ転送する共通routeを反映し、ProductionとStagingの両方でBearerなし401、未知path/admin 404を確認するまでPreviewのwatchを有効にしない。`MIKAGE_PREVIEW_WATCH_ENABLED=true`と`MIKAGE_PREVIEW_NOTIFICATION_MOCK=true`をPreviewへ、`COMPOSE_PROFILES=watch`、`WATCH_SCHEDULER_ENABLED=true`、Renderのwatch URL、およびPreviewと一致するStaging専用`MIKAGE_WATCH_EXECUTE_TOKEN`をDokploy Stagingへ設定する。watch tokenはAPI Bearerと別の値にする。設定後はMikage Staging serviceだけを手動deployする。mockはnetwork I/Oを行わず、PR Previewでのみ動作する。実際の設定値やsecretは記録しない。
9. failure injectionを行う間だけ`MIKAGE_PREVIEW_NOTIFICATION_FAILURE_MODE`を設定する。`api_failure`は通知API失敗後・DB更新前、`after_notification_before_db`はmock通知成功後・DB更新前にアプリケーション処理を503で中断する。後者は実プロセスを強制終了する試験ではない。各試験後はfailure modeを削除してPreviewを再起動し、pending状態が残って再試行で収束することを確認する。同じslotの再試行が続く間は保存済みwatch結果を再利用し、通知の重複は許容する。失敗slotからschedulerが次slotへ進んだケースは通常の5分通知間隔ルールに従うことも確認する。通知成功を確認していない状態でincident transitionが確定しないことを確認する。
10. 観察ウィンドウの T0、15分、1時間、24時間、7日でチェックポイントを取る。記録は [staging-observation-log.template.md](./staging-observation-log.template.md) に従い、phase を `Staging rehearsal` または `Production post-cutover` で明示する。Compose health、scheduler の container 内 `GET /health` JSON（`lastStatus` / `lastSuccessAt` / `jobSuccessAt` など）、migration gate（`migration_state.data_verified`）、runbook 記載の安全 HTTP 探針、DB 集計 SQL の count・時刻 delta、View の HTTP status、通知 mock / failure injection の別冊証跡を記録する。`GET /health` の 200 は migration 検証完了を意味しない。7日合格には全 checkpoint が PASS であることに加え、failure injection 別冊が PASS であることを要する。staging では production writer 稼働中のため source 件数との等値は要求せず destination delta のみ記録する。本番最終 import の同一 snapshot 照合は migration verifier が gate である。

このリハーサルが全て成功するまでは、本番Renderの接続先・GAS・Supabase cronを変更しない。

## 統合テスト（test profile、N094 本番 DB に触れない）

統合テストは本番 `postgres`（`mikage` / `mikage_postgres_data`）ではなく、production Compose と同じ PostgreSQL 17 の test profile 専用サービスだけを使う。API 用（`postgres-test-api` + `migrate-test-api` + `integration-tests`）と maintenance 用（`postgres-test-maintenance` + `migrate-test-maintenance` + `maintenance-integration-tests`）は volume・DB とも分離する。test 用 named volumeは実行後も保持される。

- Dokploy の `COMPOSE_PROFILES` を test にしたまま通常 service を常時起動しない。`docker compose --profile test up` は使わず、対象 suite だけ `run --rm` する。
- test-only secret（本番 DB password を流用しない）: `MIKAGE_TEST_POSTGRES_PASSWORD`、`MIKAGE_TEST_API_DB_PASSWORD`、`MIKAGE_TEST_MAINTENANCE_DB_PASSWORD`。未設定でも通常 deploy の Compose config は通るが、test Postgres 起動または suite 実行時は失敗する。
- suite には `MIKAGE_TEST_DATABASE_ISOLATED=true` と DB 名 `mikage_test` を設定し、fixture 前に isolation gate が `PG*` と `TEST_PG*` の一致を検証する。

```bash
cd backend/compose

docker compose -f docker-compose.yml -f docker-compose.local.yml --profile test run --build --rm integration-tests
docker compose -f docker-compose.yml -f docker-compose.local.yml --profile test run --build --rm maintenance-integration-tests
```

N094 の稼働中本番 Postgres に対して旧手順（本番 `postgres` へ接続する test profile）を実行しない。

### 保持範囲の独立照合SQL

以下をSupabase sourceとDokploy destinationの両方で実行し、件数・日時の結果を照合記録へ転記する。`targets`のheadersやURLなど値そのものは取得しない。SQLは例示であり、実行結果をverifierの合格と混同しない。

```sql
SELECT 'targets' AS table_name, count(*)::text AS row_count FROM mikage.targets;
SELECT 'logs' AS table_name, count(*)::text AS row_count,
       min(created_at)::text AS oldest_at, max(created_at)::text AS newest_at
FROM mikage.logs;
SELECT 'incidents' AS table_name, count(*)::text AS row_count,
       min(created_at)::text AS oldest_at, max(created_at)::text AS newest_at
FROM mikage.incidents;
SELECT count(*) FILTER (WHERE is_closed IS TRUE)::text AS closed_count,
       count(*) FILTER (WHERE is_closed IS DISTINCT FROM TRUE)::text AS open_or_unknown_count
FROM mikage.incidents;
SELECT 'watch_target_states' AS table_name, count(*)::text AS row_count,
       max(last_reserved_at)::text AS latest_reservation,
       max(last_checked_at)::text AS latest_check
FROM mikage.watch_target_states;
```

保持期間別件数は、JST月単位でsource/destinationそれぞれ次の集計を行い、結果を比較する。

```sql
SELECT date_trunc('month', created_at AT TIME ZONE 'Asia/Tokyo') AS month_jst,
       count(*)::text AS row_count
FROM mikage.logs
GROUP BY 1
ORDER BY 1;

SELECT date_trunc('month', created_at AT TIME ZONE 'Asia/Tokyo') AS month_jst,
       count(*)::text AS row_count
FROM mikage.incidents
GROUP BY 1
ORDER BY 1;
```

日時・countに差があれば書込みを開始せず、原因を解消してempty destinationから移行をやり直す。

## 本番切替

本番切替はこの手順だけでは開始しない。ownerの明示的な切替指示とstaging完了確認を前提とする。

1. 切替時間、作業担当、rollback判断者、観察期間、監視通知先を確認する。
2. Renderの旧DB書込み、GAS、Supabase cron、Dokployのwatch profileを停止する。sourceの新規書込みが止まったことを確認し、Supabaseの対象表件数・期間・sequenceと、空のproduction移行先を記録する。Dokploy APIは `data_verified=false` の移行先ではhealth以外を503にする。
3. `watch` profileが無効であることを再確認する。`MIKAGE_SOURCE_WRITES_FROZEN=true`を設定し、`MIKAGE_SOURCE_SNAPSHOT_ID`は空にする。staging rehearsalと同じ`migration-preflight` → `migration-import` → `migration-verify`をproduction sourceから実行する。4表の件数・最古/最新日時・保持期間別件数、sequence、FK、schema差分の全照合記録が揃うまで書込みを開始しない。APIは起動していてもmigration gateで書込みを含む全routeが503となる。
4. 一時source credential/role/acknowledgementを撤去し、migrationログ・shell履歴にsecretがないことを確認する。stream dumpはファイル化しない。
5. 全データ照合後、Dokploy専用appを手動再deployし、API healthと管理Domainを確認する。RenderへGateway origin rootと専用API Bearerを設定し、feature branchから承認済みreleaseをdeployする。まずView GETとread-only画面を確認する。この段階ではRender writer、GAS、Supabase cronを停止せず、watch profileも無効のままにする。maintenance schedulerはdestinationの照合gateとJST実行時刻に従う。
6. 限定したwatch POSTで新DBへの保存とread-backを照合する。Supabase cronが停止し旧DBへのwriteがないことを確認した後、maintenance schedulerが1 replicaで稼働していることを確認する。watch schedulerはGAS停止を再確認してから`watch` profileで有効化し、Render endpointが毎分1回だけ起動することを確認する。新旧schedulerを同時に有効化しない。
7. 即時、15分、1時間、24時間、7日で安定性を確認する。Supabaseは観察期間中保全し、完了確認前にcron/credential/databaseを撤去しない。

## 切戻し

Dokploy PostgreSQLへの書込み後に旧Render releaseへ戻すだけでは、新DBの監視結果やincident更新がSupabaseへ戻らない。現時点のimport toolはSupabaseからDokployへの一方向で、reverse transferは実装・検証していない。

1. 障害を検知したらDokploy `watch-scheduler` を停止し、Render watch executeを止める。GAS triggerとSupabase cronも停止状態を維持して二重実行・旧DBへの書込みを防ぐ。DBとnamed volumeは削除しない。
2. 新DBへの最終成功時刻と、Supabase最終snapshot以降のlogs/incidents/watch stateの差分を記録する。target設定変更もauditから確認する。
3. 新DBの差分をSupabaseへ反映する方法と完全性を検証できるまで、Supabaseへ戻すwrite切替を行わない。差分を反映できず、履歴欠落も許容できない場合は、Dokploy DBを維持して監視を一時停止し、対応方針を決める。
4. 差分を照合・解決できた場合だけ、Renderを直前の安定releaseへ戻してSupabase接続を確認する。旧DB writerの接続先をSupabaseへ戻して読み書きを検証した後、Supabase cronを再開する。GASを使う場合も最後に再開し、Dokploy `watch-scheduler` 停止を再確認する。
5. GASを再開する場合はDokploy `watch-scheduler` が停止していることを再確認する。新DB、volume、secret、ログは証跡確認が終わるまで保持し、削除・初期化しない。
6. 復旧後に原因、停止時間、失われた/重複した通知、未反映データを記録する。N094のデータを消す操作やSupabase解約は別途判断とする。

reverse transferの設計・staging rehearsalが終わるまでは、切戻しで新DB書込みをSupabaseへ自動復元できるとは扱わない。
