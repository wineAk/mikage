# Mikage VPS Gateway 設定

`gateway-office-mikage.caddy` は既存のGateway site blockへ読み込むルート断片です。単独で使うCaddyfileではありません。既存のCloudFront origin検証と `/health` handlerの後、site全体の404 handlerの前にimportします。このファイルはVPSを変更しません。

## ルートと認証

- RenderはHTTPSで `/office/mikage/<source>` を呼び、`Authorization: Bearer <MIKAGE_API_BEARER_TOKEN>` を送ります。pathにsecretを含めないため、CloudFrontのURIログに認証情報は含まれません。
- 既存のsite-level CloudFront origin検証handlerをこの断片より先に実行し、設定済み `X-Origin-Verify` がないrequestは404にします。この断片は転送前にCloudFront専用headerを削除します。
- API Bearer headerは専用API認証用に保持します。Caddy access logにrequest headerを出さず、既存の最小監査ログを使います。
- 断片には文書化された11 sourceのmethodとpathを完全一致で記載しています。不明なpath/methodは既存の404 handlerへ流します。
- Caddy rewriteはAPI pathだけを書き換え、query部分を指定しません。Caddy仕様どおり既存queryを維持し、CloudFront origin request policyでもquery stringsをすべてforwardします。
- `/admin` 、 `/admin.js` 、 `/v1/admin/*` は含めていません。CloudFront/VPS Gatewayから管理画面へrouteしてはいけません。

## Upstream

ユーザー決定により、VPSからN094へのprivate hopは既存のTailscale経路を使います。Dokploy API serviceはLAN DNSの管理domainでHTTPS公開します。DNSはN094のlocal addressへ解決し、Traefikがwildcard証明書を返すことを読み取り確認しました。VPS CaddyからはDNSのlocal addressではなくN094のTailscale addressをupstreamに指定し、HTTPSで接続します。`MIKAGE_API_UPSTREAM=https://<N094-Tailscale-IP>`、`MIKAGE_API_HOST=<Dokploy API service domain>` とし、CaddyのHostとTLS SNIの両方をこのdomainに一致させて証明書を検証します。Dokploy DomainのTLSは有効にし、API serviceだけへ割り当てます。upstream URLへcredentialやsecretを含めません。

ユーザー確認により、既存のCaddy/Tailscale経路の通信は成立しています。この経路を再調査したり、Tailscale ping/TCP port/ACLを別途確認・変更したりしません。今回新設するDokploy API routeはまだないため、staging時に既存経路から `https://<Dokploy API service domain>/health` が応答することだけ確認します。N094のDokploy Traefikがhost port 443をlistenし、LAN domainのwildcard証明書を返すことは読み取り確認済みです。証明書検証を無効化しません。管理UIは未認証のため、サービス公開時もN094の既存private boundaryを維持し、public domain/port-forwardを追加しません。

Dokploy DomainsでAPIに割り当てるのはLAN向け管理domainだけにします。インターネット公開API domainは作らず、LANと既存VPS private hopからAPIへ到達させます。DomainのHTTPSを有効にし、TLS証明書は `*.inter.dedyn.io` を使用します。Compose APIの`/health`はBearer認証がないため、公開domainを作るとDB稼働状態が外から読めます。

## Render接続前のstaging確認

1. 実際の環境ファイルを使った完全なVPS Caddyfileに断片を組み込み、secret値を出力せずCaddy config adaptation/validationを実行する。
2. 既存のTailscale経路を使い、Caddyから新APIのHTTPS応答と証明書検証を確認する。独立したTailscale/TCP疎通試験は行わない。LAN外clientからAPI serviceとAPI portが到達不能であることは確認する。
3. CloudFront経由で `/health` 、全source/method組み合わせ、view-logs/view-errors/view-incidents/view-target-proxyのquery forwarding、unknown source、誤method、origin検証headerなし、全admin pathの404を検証する。
4. APIがBearerなしで401、Render用tokenで成功することを確認する。Caddy/CloudFrontログにAuthorizationとorigin検証値がないことを確認する。
5. 設定済み両origin/failover経由で試験する。完了後にRenderの `MIKAGE_GATEWAY_BASE_URL` にはorigin rootの `https://gw.inter.dedyn.io` を設定する（`/office/mikage/<source>` はclientが追加するため、path prefixは含めない）。API Bearer tokenはRenderとAPIで同一値を安全に設定し、値をログへ出さない。

## Dokploy Compose app設定

- GitHubの `codex/supabase-dokploy-migration` branchを、既存Project内の専用Compose appとして手動deployする。Compose pathは`backend/compose/docker-compose.yml`にする。Dokployの Compose app Domains tabではAPI serviceにLAN向け管理domainだけを登録し、target container portは `3100`、HTTPSは有効、証明書は `*.inter.dedyn.io` を指定する。公開Gateway domainはAPI serviceに割り当てず、VPS CaddyはTailscale経由でAPIへHTTPS接続する。DB、schedulerにはdomainを割り当てない。
- Dokploy Domainsはdeploy時に選んだserviceへTraefik labels/networkを自動追加するため、ComposeへTraefik labelsや `dokploy-network` を手書きしない。Advanced → NetworksはCompose app内のserviceごとに設定し、APIだけを`mikage_internal`とTraefik routing用`dokploy-network`の両方へ接続する。Postgres/migrate/maintenance/tests/migrationは`mikage_internal`だけ、watch schedulerは`mikage_egress`だけに接続し、全て`dokploy-network`からdetachする。Dokploy v0.30以降に非推奨となったIsolated Deploymentsは使わない。Deploy前にPreview Composeと`docker network inspect`でdomain route、Mikage各serviceのnetwork、既存shared network memberが変わらないことを確認する。
- 管理domain `<Dokploy API service domain>` はLAN DNSでN094のlocal IPへ解決する。ユーザー確認のN094非公開状態を維持し、public Gateway経路では管理routeへ到達しないことを実測する。管理UIは未認証なので、DNSだけを境界とみなさない。
- Caddy側は`MIKAGE_API_UPSTREAM=https://<N094-Tailscale-IP>`、`MIKAGE_API_HOST=<Dokploy API service domain>`を設定する。このhostはDokploy Domain host、APIの`MIKAGE_ADMIN_ALLOWED_HOSTS`と完全一致させる。CaddyはHost headerとTLS SNIを同じdomainにし、HTTPS証明書を検証する。Caddy validateと新APIのHTTPS応答で確認する。
- Renderの `MIKAGE_GATEWAY_BASE_URL` はdomainのroot `https://gw.inter.dedyn.io` にする。clientが `/office/mikage/<source>` を追加し、path prefix付きURLはclientが拒否する。CloudFront behaviorのpath patternが`/office/mikage/*`（またはgateway専用default behavior）に一致し、既存のorigin/origin group failoverを使うことを確認する。Custom Origin Request PolicyでAuthorization headerをallowlistし、query stringsはすべてforwardする（view APIのquery条件を保持する）。Managed-AllViewerはviewer Hostもforwardして既存origin site routingを変える可能性があるため使わない。Cache PolicyはAWS managed `CachingDisabled`（Minimum/Default/Maximum TTLがすべて0）にする。Authorizationをcache keyへ入れる場合はCachingDisabled policyと併用できないので、この構成では採用しない。POSTを通すにはCloudFrontのAllowed Methodsで7 methodすべてを選ぶ必要がある。Caddyは契約済みGET/POSTだけを処理し、その他のmethod/pathは404にする。両origin/failoverとCloudFrontのstandard/realtime logでAuthorization header/値が記録またはcacheされないことを確認してからRenderを接続する。CloudFrontはAuthorizationをdefaultではoriginへforwardしないため、policy設定の実測を必須とする。

Tailscale transportは確定し、ユーザーは既存Caddy経路の通信成功を確認しています。LAN DNSの管理domainでTraefikのHTTPS wildcard証明書を読み取り確認しました。未確認なのはDokploy API serviceへのDomain設定、VPS CaddyのTailscale IP + HTTPS/SNI接続、および新API routeの統合応答です。既存Caddy経路のTailscale/ACLを再検査・変更せず、Caddy/Dokploy変更は専用Compose serviceに限定します。
