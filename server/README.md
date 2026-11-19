# Welcome to React Router!

A modern, production-ready template for building full-stack React applications using React Router.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/remix-run/react-router-templates/tree/main/default)

## Features

- 🚀 Server-side rendering
- ⚡️ Hot Module Replacement (HMR)
- 📦 Asset bundling and optimization
- 🔄 Data loading and mutations
- 🔒 TypeScript by default
- 🎉 TailwindCSS for styling
- 📖 [React Router docs](https://reactrouter.com/)

## Getting Started

### Installation

Install the dependencies:

```bash
npm install
```

### Development

Start the development server with HMR:

```bash
npm run dev
```

Your application will be available at `http://localhost:5173`.

## Building for Production

Create a production build:

```bash
npm run build
```

## Deployment

### Docker Deployment

To build and run using Docker:

```bash
docker build -t my-app .

# Run the container
docker run -p 3000:3000 my-app
```

The containerized application can be deployed to any platform that supports Docker, including:

- AWS ECS
- Google Cloud Run
- Azure Container Apps
- Digital Ocean App Platform
- Fly.io
- Railway

### DIY Deployment

If you're familiar with deploying Node applications, the built-in app server is production-ready.

Make sure to deploy the output of `npm run build`

```
├── package.json
├── package-lock.json (or pnpm-lock.yaml, or bun.lockb)
├── build/
│   ├── client/    # Static assets
│   └── server/    # Server-side code
```

## 監視スケジュール

`/api/v1/watch` は現行環境ではGASから毎分呼び出される。移行branchではquery `key` を廃止し、`MIKAGE_WATCH_EXECUTE_TOKEN` の `Authorization: Bearer ...` headerで認証する。監視対象と実行時間帯はミカゲ側で管理する。時刻判定はJSTを使用し、日本の祝日は年単位の祝日APIを24時間キャッシュして判定する。祝日一覧を取得できず有効なキャッシュもない場合は、毎分1対象の巡回に切り替える。

| 条件 | 実行内容 |
| --- | --- |
| 平日 08:00〜09:00、18:00〜19:00 | 5分ごとに全対象を確認 |
| 平日 09:00〜18:00 | 毎分全対象を確認 |
| 上記以外 | 毎分1対象を巡回（19対象なら各対象は約19分ごと） |
| 土日祝日 | 毎分1対象を巡回 |
| 年末年始・設定した休暇期間 | 毎分1対象を巡回 |

対象が失敗した場合は初回時刻を保存し、5分後以降の確認で再び失敗した場合に障害として通知する。巡回方式では初回検知まで最大約19分、その後の確認を含めて通知まで最大約24分かかる場合がある。

年末年始は設定なしでも毎年12月29日から翌年1月3日まで、JST の日付で巡回する。会社の休業日が異なる場合や夏季休暇などを追加する場合は、サーバーの `WATCH_REDUCED_POLLING_PERIODS` に開始日と終了日を含む期間を設定する。複数期間はカンマで区切り、設定時は既定の年末年始期間を置き換えるため、必要な年末年始期間も含める。

```dotenv
WATCH_REDUCED_POLLING_PERIODS=2026-12-28/2027-01-04,2027-08-10/2027-08-13
```

日付は `YYYY-MM-DD` 形式の実在日付とし、開始日を終了日以前にする。設定が不正な場合は全件監視を避けるため、平日も毎分1対象の巡回へ切り替えて警告を記録する。設定変更後はアプリを再起動し、監視 API 応答の `execution.reason` が対象期間に `closure_period`、期間外は通常の理由になっていることを確認する。期間中は各対象の確認間隔が長くなり、障害検知と復旧確認も遅くなる。

### Database migration status

移行用feature branchでは、通常のView・監視・target proxy処理をMikage API経由へ置き換えている。新しいSupabase secret keyをRenderへ登録したり、Supabaseへmigration SQLを適用したりしない。SupabaseからDokploy PostgreSQLへのデータ移行手順は [`backend/README.md`](../backend/README.md) に記載している。実データ移行と本番切替は未実施。

### Dokploy API Gateway（移行ブランチ）

View/monitoring APIは `MIKAGE_GATEWAY_BASE_URL` と `MIKAGE_API_BEARER_TOKEN` を使い、Render serverからVPS Gateway経由でDokploy上のMikage APIを呼ぶ。`MIKAGE_GATEWAY_ROUTE_PREFIX` の既定値は `office/mikage`。PR PreviewをStagingへ隔離するときだけ `office/mikage-staging` に切り替え、Caddyの同prefix共通routeがDokploy Staging APIへ転送する。watch起動は別の `MIKAGE_WATCH_EXECUTE_TOKEN` で保護し、schedulerからRenderへ渡す。両tokenはserver-only環境変数とし、`VITE_`を付けない。Caddyは個別source/path allowlistを持たず、各APIの `/gw` routeが公開operationを限定する。`/gw` 対応branchはDokployへdeploy済みで、Production用Caddyの共通routeもVPSへ反映済み。Staging専用Caddy routeとPreview隔離は未検証なので、Preview watchは有効にしない。2026-11-19にN094 APIの認証付きView GETが200、Render PR Previewの `GET /api/v1/targets` が200で19件、ホーム・インシデント・エラーページも200になることを確認した。POST保存/read-back、Preview watchの失敗注入と通知抑止、CloudFront policy/cache/logging/query forwardingは未確認。GASの既存query-key triggerはfeature branchと互換がないため、本番切替のscheduler起動元変更と同時に停止する。

### ロールバック

本番切替は未実施。切替後に不具合が起きた場合、アプリreleaseだけを戻しても新DBへ保存した監視結果はSupabaseへ戻らない。専用schedulerを停止して二重実行を防ぎ、新旧DBの書込み差分と切戻し先を確認する。実施順と停止条件は [Dokploy運用手順](../backend/docs/deployment-runbook.md) を参照する。具体的な切替・切戻し手順が承認されるまではGAS、Render環境変数、Supabase cronを変更しない。

## Styling

This template comes with [Tailwind CSS](https://tailwindcss.com/) already configured for a simple default starting experience. You can use whatever CSS framework you prefer.

---

Built with ❤️ using React Router.
