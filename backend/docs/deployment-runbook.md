# Dokploy移行・運用手順

この手順は、Mikage専用Dokploy Compose appのstaging、Supabaseからのデータ移行、本番切替、切戻しを扱う。N094、Render、VPS Gateway、Supabaseの設定変更は、該当する工程の承認と前提確認が終わるまで行わない。

## 固定する運用境界

- Dokployでは専用Project内のMikage Compose appだけを操作する。Dokploy全体設定、他service、global schedule/jobは変更しない。
- Compose定義は `backend/compose/docker-compose.yml`、Git Compose pathも同じファイルを指定する。GitHub branchとcommitはdeployごとに記録し、Dokployから手動deployする。
- schedulerはCompose service内に置き、watch schedulerとmaintenance schedulerをそれぞれ1 replicaで動かす。Dokploy Schedule Jobやhost timerは追加しない。
- Postgres portはhostへ公開しない。Postgresのnamed volumeは `mikage_postgres_data` 専用とし、既存DBのvolumeと共有しない。
- Compose serviceのNetworksは対象Dokploy app内だけ設定する。Dokploy Domainsが必要な`api`のみ`dokploy-network`へ接続し、Postgres/migrate/scheduler/test/migration serviceは共有`dokploy-network`から外してCompose定義の専用networkだけに置く。既存serviceやDokploy全体networkの変更はしない。Dokploy v0.30以降に非推奨となったIsolated Deployments toggleは使わず、Advanced → Networksのservice単位Attach/Detachを使う。
- API serviceにだけLAN向けDokploy Domainを設定する。Domain/DNSとHost allowlistだけでは到達元を制限しない。ユーザーはN094非公開と既存VPS Caddy/Tailscale経路の通信成功を確認済み。今回のdeploymentでは既存network設定に変更を加えず、新API serviceが既存経路経由で応答することと管理DomainがLAN内でだけ到達できることを検証する。admin画面/APIにログイン認証はないため、Domain設定後にLAN外と公開Gateway経路から到達しないことを確認する。Dokploy/Traefik全体設定や他serviceを変更して解決しない。
- Renderの `MIKAGE_GATEWAY_BASE_URL` はorigin root `https://gw.inter.dedyn.io` とする。`/office/mikage` はRender clientが付ける。API Bearer、watch execute token、DB passwordは用途ごとに別値を使い、service単位のsecretとして設定する。
- バックアップは作成しない。N094またはvolumeを失った場合、データを復元できない可能性がある。移行時のstream dumpはバックアップではなく一時転送として扱い、移行後に残さない。

## deploy前チェック

- [ ] branch、commit、Dokploy Project/app、Compose pathが意図したMikage専用のものと一致する。
- [ ] DokployのDomains tabでDomainは`api` serviceだけに割り当てる。Advanced → Networksの設定を次の表に合わせる。

  | Compose service | Compose network | `dokploy-network` |
  | --- | --- | --- |
  | `api` | `mikage_internal` | attach（Domain/Traefik用） |
  | `postgres`, `migrate`, `maintenance-scheduler`, `integration-tests`, `maintenance-integration-tests`, `migration-import`, `migration-preflight`, `migration-snapshot`, `migration-verify` | `mikage_internal` | detach |
  | `watch-scheduler` | `mikage_egress` | detach |

  Preview Composeと`docker network inspect`で、共有networkにはMikageの`api`以外が参加せず既存memberが変化していないことを確認する。Postgres・scheduler・test/migration serviceに公開Domain/host portがない。
- [ ] staging/production移行中はDokploy Compose環境の `COMPOSE_PROFILES` を空欄にする。このとき`postgres`と一回限りの`migrate`だけが起動し、`api`とscheduler、migration/test profileのserviceは起動しない。importとverifier成功後にだけ `runtime` を設定して手動再deployする。
- [ ] `runtime`を有効化してAPIを起動する構成では、`migration-verify`成功前も`/health`はDB接続を返し、それ以外の全routeが503で閉じることを確認する。health 200はmigration gate通過を意味しない。watch/maintenance schedulerはAPI healthcheck成功後に起動する。maintenance jobも実行直前にDB gateを再確認する。
- [ ] APIの `MIKAGE_ADMIN_ALLOWED_HOSTS` はLAN専用Domainのみ、`MIKAGE_TARGET_ALLOWED_HOSTS` は現在のenabled target hostを完全一致で含む。
- [ ] API Domain設定後、LAN内と既存VPS Caddy/Tailscale経路から必要なAPI pathへ到達でき、LAN外と公開Gateway経路から管理画面/APIへ到達できないことを実測する。ユーザーが確認した既存network pathや他serviceは変更しない。
- [ ] CloudFrontがAuthorizationをoriginへforwardし、queryを保持し、cacheを無効化している。standard/realtime logにAuthorizationが出ないことを確認する。GreenCloud/RackNerd両originでも確認する。
- [ ] targetのAPI key/Cookieなど既存認証値をローテーションし、staging用とproduction用の通知先を分離する。
- [ ] `watch-scheduler` は確認完了まで無効。GASとの同時起動を防ぐ停止・再開担当とタイミングを決める。
- [ ] healthcheckの失敗を誰が監視し、どこへ通知するかを設定する。Composeのhealth表示だけで監視完了とはみなさない。

一つでも満たさない場合、staging接続、migration import、scheduler有効化へ進まない。

## staging構築と移行リハーサル

1. 本番volumeと分離した空のstaging DB/appを用意し、GitHub feature branchをDokployから手動deployする。branch/commit、service状態、health、Domainを記録する。
2. 初回deployでは `COMPOSE_PROFILES` を空欄にしてDBとschema migrationだけを起動する。`postgres`と一回限りの`migrate`が完了し、`api` と両schedulerが起動していないこと、Postgres host portがなく、管理DomainからAPIへ接続できないことを確認する。
3. 監視起動、外部通知、Render staging接続を無効のままにし、通知をmockまたは安全なstaging通知先へ向ける。production Instatus/Google Chatへ送らない。
4. Supabase sourceのhost/port/database、TLS CA、read-only用一時credentialを用意する。sourceの現行schema、RLS、対象4表の行数・期間・sequenceを取得し、既存writerを特定する。
5. stagingでは本番Render writer、GAS、Supabase cronを停止しない。まず`docker compose --profile migration run --rm migration-preflight`を実行してschema-only照合を済ませる。Supabase sourceへの専用TLS接続を用意し、別terminalで`docker compose --profile snapshot run --rm -it migration-snapshot`を対話起動する。sourceセッションで次を入力し、出力されたsnapshot IDを記録する。

   ```sql
   BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
   SELECT pg_export_snapshot();
   ```

   psqlのトランザクションを開いたまま維持する。snapshot exporterを閉じるとsnapshot IDは失効するため、短時間にdumpとverifierを終える。長時間保持はVACUUMによるdead row回収を遅らせる。snapshot IDをmigration service環境の`MIKAGE_SOURCE_SNAPSHOT_ID`へ設定し、`MIKAGE_SOURCE_WRITES_FROZEN`は設定しない。snapshot IDは秘密値ではないが、完了後に環境から消す。
6. 空の移行先で`migration-import`を実行し、終了後に`migration-verify`を実行する。importerは完了済みpreflightとDBを依存先に持つ。verifierはimporterを依存先にしない（検証時に空DB専用importerをComposeが再起動しないようにするため）。このため実行順は手動で守り、両serviceに同じ`MIKAGE_SOURCE_SNAPSHOT_ID`を設定する。importerの`pg_dump --snapshot`とverifierのREPEATABLE READ transactionが同じexported snapshotを使うため、通常の監視書込みやcronが継続しても同一DB時点のtable rowsを比較できる。sequence値はMVCC snapshotに含まれず稼働中に進むため、staging verifierは移行先がsnapshot内の最大IDを再利用しないことを確認し、source/destinationのsequence完全一致は要求しない。本番切替はwriter停止モードで実行し、sequenceの完全一致を検証する。importer/verifierはsource接続roleがsuperuserまたは`BYPASSRLS`であることを確認する。verifierは対象4表のrow hash/count、identity sequence安全性、FK孤児、schema contractを照合し、全検査の成功後にだけmigration gateを開く。保持期間境界と重要集計は同じsnapshot時点のsourceとdestinationで別途照合する。不一致なら同じ移行先を再利用せず、空の専用DBからやり直す。検証後、snapshot psqlで`ROLLBACK;`してから`\q`で終了する。snapshot ID、一時source credential、CAをmigration環境から削除し、一時migration roleをSupabaseから撤去する。
7. schema-only preflight後、stagingで`COMPOSE_PROFILES=runtime`を設定して手動再deployし、import/verifier前に`/health`だけがDB接続を返し、それ以外のAPI routeが503で閉じることを確認する。health 200はmigration gate通過を意味しない。import/verifierのmigration serviceはCompose dependencyに従ってAPI起動後も実行できることを確認し、verifier成功後に管理画面、retention/reindexを確認する。sourceとdestinationは別DBなのでSupabase cronを維持したままdestination maintenanceを検証できる。watch schedulerはRender staging endpointと安全な通知sinkを用意して明示確認するまで`WATCH_SCHEDULER_ENABLED=false`のままにする。
8. Render stagingを手動deployし、社内IP/通常IPのDB選択、View GET、watch結果POST、重複予約、target管理、revision更新、API再起動、JST/祝日周期を検証する。
9. 外部通知成功後・DB保存前にRender processを停止するfailure injectionを行う。再開後、同じslotの再試行が続く間は保存済みwatch結果を再利用し、pending状態から通知を再送して重複を許容しながら、後続のDB保存成功でstateが収束することを確認する。失敗slotからschedulerが次slotへ進んだケースは通常の5分通知間隔ルールに従うことも確認する。通知API自体を失敗させるケースも別に注入し、pendingが残って次tickで再試行され、通知成功を確認していない状態でincident transitionが確定しないことを確認する。
10. 15分、1時間、24時間、7日の時点でAPI/DB/scheduler health、request失敗、遅延、行数増分、通知、View表示を確認する。stagingで未検証の項目と実測値を記録する。

このリハーサルが全て成功するまでは、本番Renderの接続先・GAS・Supabase cronを変更しない。

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
2. Renderの旧DB書込み、GAS、Supabase cron、Dokploy runtime serviceを停止する。sourceの新規書込みが止まったことを確認し、Supabaseの対象表件数・期間・sequenceと、空のproduction移行先を記録する。
3. `COMPOSE_PROFILES` が空欄でruntime serviceが停止していることを再確認する。`MIKAGE_SOURCE_WRITES_FROZEN=true`を設定し、`MIKAGE_SOURCE_SNAPSHOT_ID`は空にする。staging rehearsalと同じ`migration-preflight` → `migration-import` → `migration-verify`をproduction sourceから実行する。4表の件数・最古/最新日時・保持期間別件数、sequence、FK、schema差分の全照合記録が揃うまで書込みを開始しない。
4. 一時source credential/role/acknowledgementを撤去し、migrationログ・shell履歴にsecretがないことを確認する。stream dumpはファイル化しない。
5. 全データ照合後、`COMPOSE_PROFILES=runtime` を設定してDokploy専用appを手動再deployする。API healthを確認する。RenderへGateway origin rootと専用API Bearerを設定し、feature branchから承認済みreleaseをdeployする。まずView GETとread-only画面を確認する。この段階ではRender writer、GAS、両maintenance schedulerは停止を維持する。
6. 限定したwatch POSTで新DBへの保存とread-backを照合する。Supabase cronが停止し旧DBへのwriteがないことを確認した後、Dokploy maintenance schedulerを1 replicaで起動する。watch schedulerはGAS停止を再確認してから有効化し、Render endpointが毎分1回だけ起動することを確認する。新旧schedulerを同時に有効化しない。
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
