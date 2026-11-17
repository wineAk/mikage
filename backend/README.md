# Mikage 専用 PostgreSQL / 監視 API

Render / Supabase / GAS の本番切替はまだ行っていない。Dokploy専用Compose appにはPostgreSQLとschema migrationをdeployし、Supabase staging snapshotのimportと独立verifierも完了している。APIとmaintenance schedulerはComposeの通常serviceとして起動する。watch schedulerは専用 `watch` profileで隔離し、GAS/Render切替が終わるまで起動しない。本番データ移行、実Gateway接続、Render/GAS/scheduler切替は未完了。

## 含まれるもの

- `compose/`: 専用 Postgres・API・migration ワンショット・Render起動scheduler・DB maintenance scheduler
- `db/`: version 順 migration、`reserve_watch_run`、logs/incidents専用maintenance role、開発 seed
- `api/`: Express API（health、monitoring予約/結果、incident state遷移、View read、target管理画面/API）
- `scheduler/`: Render起動workerとJSTのretention/reindex worker

## 含まれないもの（ルート計画どおり）

- Supabase実データ移行の実行、Render production変更、GAS停止、scheduler有効化（import / verify用の手動toolingと初回Dokploy deployは完了）
- Render-to-Gatewayの実接続検証

## Dokploy運用・切替手順

本番切替、実Gateway検証、Render/GAS停止、切戻しの順序と停止条件は [deployment-runbook.md](./docs/deployment-runbook.md) を参照する。DokployへのDB/API deploymentとstaging snapshotの移行は完了しているが、本番データ移行とアプリの接続先切替は未実施。

## ローカル起動

```bash
cd backend/compose
cp .env.example .env
# POSTGRES_PASSWORD、DB password 2種、API/watch tokenを個別にランダム生成して設定
# 管理画面をローカルで開く場合は、targets.lan.example を127.0.0.1へ名前解決させる
# （hostsファイルへ 127.0.0.1 targets.lan.example を追加し、http://targets.lan.example:3101 を開く）
# ローカルはwatch profileを有効化しない。DokployではGAS停止を確認後、watch profileとservice環境変数を明示して起動

docker compose -f docker-compose.yml -f docker-compose.local.yml up --build -d
# Local development only: release the runtime gate for this local database.
docker compose -f docker-compose.yml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE mikage.migration_state SET data_verified=true, verified_at=clock_timestamp() WHERE singleton=true"'
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build -d
```

Postgres は Compose network 内のみ。API は `127.0.0.1:3101` にbind（local override）。admin Host allowlistはloopback名・IP自体を拒否するため、ローカル画面もallowlist済みの `targets.lan.example` で開く。watch schedulerは `WATCH_SCHEDULER_ENABLED` に `true` または `false` を明示しないと起動しない。
`.env.example` はpassword/tokenが空なので、そのままでは起動できない。ローカル用の別々のランダム値を設定し、Gitへ追加しない。

### 開発 seed（任意）

```bash
docker compose -f docker-compose.yml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ../db/seed/dev-targets.sql
```

本番 Compose 起動では seed を自動実行しない。

### migration の再適用

`migrate` サービスは起動のたびに `schema_migrations` を参照し、未適用分だけ実行する。
`api` と `maintenance-scheduler` は通常serviceとして起動する。`/health` を除くAPI routeは `mikage.migration_state.data_verified` がtrueになるまで503で閉じ、healthcheckはDB接続だけを確認する。maintenance schedulerはAPI healthcheckとschema migrationの完了後に起動し、各削除・REINDEX jobの直前にも同じDBゲートを確認する。watch schedulerだけを `watch` profileに置き、GAS/Render切替の承認が済むまで起動しない。Dokploy環境の `COMPOSE_PROFILES` は移行と初期確認中は空欄にする。watch切替の承認後にだけ、対象service内で `watch` profileを有効にし、`WATCH_SCHEDULER_ENABLED=true` とRender URL/tokenを設定する。他のserviceやDokploy全体設定には触れない。
PostgreSQL管理ユーザーとmigration serviceが `mikage_api` と `mikage_maintenance` roleを管理する。API runtimeは `mikage_api`、maintenance workerは `logs` / `incidents` と2つの冪等性batch表だけを所有するroleで接続する。logs/incidentsはevent時刻、冪等性記録は `saved_at` を基準に、いずれもJST前月初境界で削除する。watch schedulerはRender用tokenだけを持ち、DB/API networkに参加しない。ローカルは無効、Dokployは対象Compose serviceの環境変数で有効を明示し、Render URL/token未設定時は起動に失敗する。接続設定はURL連結を避け、個別の `PG*` 環境変数で渡す。

### Supabase データ移行（手動ワンショット）

通常のDokploy起動ではDB、schema migration、API、maintenance schedulerが起動する。`migration-verify` は全検査成功後に限り `mikage.migration_state.data_verified` をtrueにする。APIはこの状態を確認して `/health` 以外の全routeを開き、`/health` はDB接続だけを確認する。maintenance schedulerはAPI healthcheck成功後に起動し、job直前にもDBゲートを確認する。watch schedulerは `watch` profileに隔離し、GAS切替の確認が完了するまでprofileを有効にしない。watch切替承認後は対象serviceの `COMPOSE_PROFILES=watch` と `WATCH_SCHEDULER_ENABLED=true`、Render URL/tokenを設定する。

`migration-import` は Compose の `migration` profile にのみ属し、通常のDokploy起動では実行されない。source接続情報は `.env` または対象Dokploy serviceの一時secretとして設定し、`verify-full`でTLS証明書とhost名を検証する。Supabase DashboardのDatabase settingsからroot certificateを取得し、Base64化した内容を `MIKAGE_SOURCE_PGSSLROOTCERT_BASE64` に設定する。IPv4環境ではDashboardのConnectからSession pooler（port 5432）を選ぶ。transaction pooler（6543）は使わない。対象4表のうちmonitoring state tablesはRLS有効のため、移行専用roleには一時的に `BYPASSRLS` 属性が必要になる。これはRLSを無視する強い属性なので、対象4表と2 sequenceだけへの明示GRANT、role membershipなし、read-only transaction、短時間利用、照合後のDROP ROLEを組み合わせる。importerとverifierは接続roleの `rolsuper` / `rolbypassrls` を確認し、RLSを迂回できないroleを拒否する。移行前に現在のschema/table/sequence名、所有者、RLS設定、grant、role attributeと実データ可視性を再確認する。

```sql
CREATE ROLE mikage_migration_reader LOGIN BYPASSRLS PASSWORD '<一時ランダムパスワード>';
GRANT CONNECT ON DATABASE postgres TO mikage_migration_reader;
GRANT USAGE ON SCHEMA mikage TO mikage_migration_reader;
GRANT SELECT ON TABLE mikage.targets, mikage.logs, mikage.incidents, mikage.watch_target_states TO mikage_migration_reader;
GRANT SELECT ON SEQUENCE mikage.logs_id_seq, mikage.incidents_id_seq TO mikage_migration_reader;
```

接続databaseが`postgres`以外ならdatabase名を置換する。`BYPASSRLS`はこの一時roleにだけ付け、既存roleの属性やmembershipは変更しない。host/port/database/SSL CAとread-only role credentialだけをmigration環境へ設定する。PATは使わない。移行・照合完了後、Supabaseで次を実行して一時roleと権限を撤去する。

```sql
REVOKE SELECT ON SEQUENCE mikage.logs_id_seq, mikage.incidents_id_seq FROM mikage_migration_reader;
REVOKE SELECT ON TABLE mikage.targets, mikage.logs, mikage.incidents, mikage.watch_target_states FROM mikage_migration_reader;
REVOKE USAGE ON SCHEMA mikage FROM mikage_migration_reader;
REVOKE CONNECT ON DATABASE postgres FROM mikage_migration_reader;
DROP ROLE mikage_migration_reader;
```

destinationでは `targets`, `logs`, `incidents`, `watch_target_states`, `watch_scheduler_lock`, `watch_result_batches`, `incident_transition_batches`, `target_change_audit` が空で、`page_cache_revision` がmigration初期値1行のみ、3つのidentity sequenceが未使用の場合だけimportする。対象4表のデータと `logs_id_seq` / `incidents_id_seq` はcustom-format streamで移し、dumpファイルは作らずrestoreは単一transactionで行う。`logs_test` / `incidents_test`、Supabase管理schema・roleは移さない。importまたはverifier失敗後は部分状態を再利用せず、新しい専用DBを作る。

Supabase Session Poolerでは`PGOPTIONS`が接続に適用されない。importerは`BEGIN READ ONLY`で明示的にread-only状態を検査し、PostgreSQL 17の`pg_dump --snapshot`も自身のdump transactionを`REPEATABLE READ, READ ONLY`にする。stagingでは本番writerを停止せず、`migration-snapshot` を対話起動してsourceで `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();` を実行する。exporter transactionを開いたまま、返されたIDを `MIKAGE_SOURCE_SNAPSHOT_ID` としてimporterとverifierへ渡す。pg_dumpとverifierが同じDB snapshotを読むため、並行するsource writesによるrow count/hash driftを避けられる。PostgreSQL sequence値はMVCC snapshotに含まれず進み続けるため、stagingではdestination sequenceがsnapshot内の最大IDより大きく次IDを安全に発行できるかを確認し、source/destination sequenceの完全一致は要求しない。本番cutoverはwriter停止後にsequence値を完全比較する。snapshot exporterはVACUUMのdead row回収を遅らせるため、短時間でimport/verifyし、成功後にtransactionを閉じ、snapshot IDとsource credentialsをCompose service環境から消す。

本番切替ではRender writer、GAS、Supabase cron、Dokploy API/schedulerを停止し、sourceへ新規書込みがないことを担当者が確認してから `MIKAGE_SOURCE_WRITES_FROZEN=true` を設定する。この値は実環境の停止を自動検査しない。production importでは `MIKAGE_SOURCE_SNAPSHOT_ID` を空にし、importからverifier完了まで停止状態を維持する。import/verifierのsource sessionはread-onlyだが、それだけでは別roleのwriterを止められない。

```bash
cd backend/compose
docker compose --profile migration run --rm migration-preflight
docker compose --profile migration run --rm migration-import
docker compose --profile migration run --rm migration-verify
```

`migration-preflight` は4表の列・制約とmigration先の必須objectをread-onlyで照合し、source row dataを読まずに終了する専用serviceである。migration profile限定なので通常のDokploy起動では実行されない。必ずsnapshot exporterを起動する前に実行し、schema不一致なら空のmigration先を作り直す前に差異を解決する。stagingではその後にsnapshot IDを設定してimporterとverifierを実行する。productionではsnapshot IDを空にし、writer freeze acknowledgementを設定する。

schema照合では列名で定義を対応付けるため列の並び順は問わない。共通列の型・nullable・default・identityなどは厳密比較し、移行先専用の `targets.is_enabled` と `incidents.notification_pending` はmigration定義どおり存在し属性が一致することを別途確認する。Supabase側に `targets.is_enabled` がある場合はその属性も移行先と厳密比較する。`information_schema.columns.column_default` はPostgreSQLが同じ値を返す式でもcast・引用符表記が異なれば不一致として止め、default checkは緩めない。Supabase `incidents.keyword` / `count` の実式との差はversioned migration `015_incident_default_parity.sql` でDokploy側を合わせる。import前に新しいmigrationを適用し、schema-only preflightを再実行して成功を確認する。

2つ目のread-only verifierはsource/destinationのschema contractを確認してから、両DBのデータを1000行ずつ比較し、target key / 各行内容 / 有効状態 / sequence / FK / 未使用scheduler lockを確認する。schema contractでは移行対象4表の列・制約と移行に関係するindexをsource/destinationで照合する。revision/idempotency/auditなどdestination専用table、sequence、function、index、triggerはdestinationで必須のものとして確認し、source側に存在することは要求しない。legacy `targets.is_enabled`はsourceに存在する場合だけ値を保持し、なければ全targetをenabledとして照合する。さらに有効targetのURLだけをhostname allowlist検証する。disabled targetは監視APIから使われないためこのURL gateの対象外だが、再有効化前には管理APIでallowlist検証される。画面・ログへ列値や `headers` は出さず、照合成功だけを表示する。staging verifierはsource exported snapshotをimportし、本番verifierはsource writer freezeを前提にする。watch/maintenance各schedulerは常に1 replicaで動かす。ローカル・stagingとも実データ移行はまだ実行していない。

管理API、監視API、View previewのいずれもtarget `headers` を同一構造制約（HTTP header名、string値、最大100件、CR/LFなし、8KB以下）で検証する。API側preview許可hostとRender側preview許可hostはunit testで同じ集合か確認する。preview hostは既存のpreview対象制限であり、`MIKAGE_TARGET_ALLOWED_HOSTS`より狭いsubsetである。

## テスト

専用test profileを使う。API runtime roleと、fixtureのreset専用DB管理roleを分離してテストする。

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml --profile test run --build --rm integration-tests
```

`integration-tests` は `test` profile限定で、通常のDokploy deployでは起動しない。fixture投入のため管理roleを使うのはテストserviceのみ。

Render source allowlist、Caddy method/path rewrite、Dokploy Host routing headerの対応はrepository rootから `node --test backend/docs/gateway-contract.test.mjs` で確認する。この契約testはCompose test containerへ持ち込まず、Git checkout上で実行する。

## Dokploy 運用境界

- 本ディレクトリの Compose 定義は **専用 Project / 専用 app** のみに deploy する。
- Dokploy 全体の Traefik、他 service、global schedule / job には変更を加えない。
- named volume `mikage_postgres_data` は他 DB と共有しない。
- `mikage_watch_scheduler_state` と `mikage_maintenance_scheduler_state` は各scheduler専用のヘルス状態保存用volume。DBバックアップ用途ではなく、再起動後も最終成功時刻を判定するために使う。
- DomainsはDokployの当該Compose app内のserviceにのみ紐付ける。scheduleは専用Compose service内に置く。
- APIのLAN向けDomainだけを対象Compose appのDomains tabに登録し、container port `3100` とHTTPSを指定する。証明書は `*.inter.dedyn.io` を使う。公開Gateway domainはAPI serviceに割り当てず、VPS Gatewayは既存Tailscale経路からN094 Tailscale IPへHTTPS接続する。Dokployがdeploy時にTraefik labels/networkを自動付加するため、Composeへ手動router labelや共有routing networkを記述しない。Advanced → NetworksでDomainが必要なAPIのみを`dokploy-network`へ接続し、他のCompose serviceは共有networkから外して独自networkに置く。Isolated Deployments toggleはv0.30以降deprecatedのため使用しない。deploy前にPreview Composeと`docker network inspect`で対象appの各serviceを確認する。API `/health` はBearer認証なしなので公開domainへ出さない。
- Caddyは`MIKAGE_API_UPSTREAM=https://<N094-Tailscale-IP>`へ接続し、`Host` と TLS SNI を `MIKAGE_API_HOST` に設定して証明書を検証する。Tailscale経路を使うためDNSのLAN IPへは接続しない。Dokploy TraefikはHostでserviceを選ぶ。
- DokployのGit Compose pathは`backend/compose/docker-compose.yml`を指定する。build contextが同directoryから`../api`, `../db`, `../scheduler`を参照することをPreview/buildで確認する。
- Renderの `MIKAGE_GATEWAY_BASE_URL` はorigin rootの `https://gw.inter.dedyn.io` にする。Render clientが `/office/mikage/<source>` を付けるため、path prefixは設定しない（clientもroot以外を拒否する）。CloudFront behaviorが`/office/mikage/*`をGateway origin groupへ流すこと、Custom Origin Request PolicyでAuthorizationをforwardしquery stringsはすべてforwardすることを確認する。Cache Policyはmanaged `CachingDisabled`（TTLすべて0）。POSTを許可するためCloudFront Allowed Methodsは全7 methodとなるが、Caddyは契約したGET/POST以外を404にする。Managed-AllViewerは既存originのHost routingを変える可能性があるので使わず、Authorizationが標準/リアルタイムログへ記録されないことを確認する。
- `watch-scheduler` はRender起動用tokenだけを持ち、PostgreSQL/APIの `mikage_internal` networkに参加しない。`maintenance-scheduler` は別serviceとして、`logs`、`incidents`、`watch_result_batches`、`incident_transition_batches` だけを所有する `mikage_maintenance` roleで削除/reindexする。
- 管理画面 `/admin` と `/v1/admin/*` は未認証である。LAN内の専用service domainからのみ利用し、VPS Gatewayの公開経路へ流さず、N094のFW/NATで外部到達を拒否することをdeploy前提とする。
- `MIKAGE_ADMIN_ALLOWED_HOSTS` は必須で、管理routeは許可Hostの完全一致だけ応答する。本番ではLAN向けDokploy service domainだけを指定し、公開Gateway Hostは含めない。
- `MIKAGE_TARGET_ALLOWED_HOSTS` は実際のenabled target URL hostを完全一致で列挙する。管理APIは新規/更新/再有効化時、監視APIは有効targetをRenderへ返す前にURL/headersを検査し、migration verifierはSupabase/移行先の有効targetを照合する。disabled targetは監視・previewで使用しない。未設定または不一致ならfail closedにする。値はDokployのAPI serviceと一時migration-verify serviceへ同じものを設定する。

## Caddy / Gateway（将来）

Render → `gw.inter.dedyn.io/office/mikage/<source>` → N094 API のCaddy/private-hop経路は未実装。Render側のGateway clientはfeature branchにあり、実通信は未検証。endpoint契約と未完了範囲は [api-contract.md](./docs/api-contract.md) に記載。
