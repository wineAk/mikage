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

`/api/v1/watch` はGASから毎分呼び出される。監視対象と実行時間帯はミカゲ側で管理する。時刻判定はJSTを使用し、日本の祝日は年単位の祝日APIを24時間キャッシュして判定する。祝日一覧を取得できず有効なキャッシュもない場合は、毎分1対象の巡回に切り替える。

| 条件 | 実行内容 |
| --- | --- |
| 平日 08:00〜09:00、18:00〜19:00 | 5分ごとに全対象を確認 |
| 平日 09:00〜18:00 | 毎分全対象を確認 |
| 上記以外 | 毎分1対象を巡回（19対象なら各対象は約19分ごと） |
| 土日祝日 | 毎分1対象を巡回 |

対象が失敗した場合は初回時刻を保存し、5分後以降の確認で再び失敗した場合に障害として通知する。巡回方式では初回検知まで最大約19分、その後の確認を含めて通知まで最大約24分かかる場合がある。

### Supabase設定

`server/sql/monitoring-schedule.sql` をSupabase SQL Editorで一度適用する。Renderには `SUPABASE_SECRET_KEY` をサーバー専用環境変数として登録する。値を `VITE_` 接頭辞付きの環境変数、ブラウザー、ログ、API応答へ出さない。このSecret KeyはRLSを迂回し、プロジェクト全体のDB権限を持つ。サーバー側のスケジューラ専用クライアントからのみ使う。

既存の `VITE_SUPABASE_ANON_KEY` は通常のアプリ処理に使い続ける。`SUPABASE_SECRET_KEY` が未設定、SQL未適用、または予約・状態保存に失敗した場合、対象サイトの確認やインシデント復旧判定は行わず、監視APIはエラーを返す。

### ロールバック

監視処理に問題があった場合は、Renderで直前のアプリケーションリリースへ戻す。GASの毎分トリガーは変更していないため、旧アプリでは従来どおり全対象を確認する。ロールバック後に旧アプリの稼働を確認してから、今回追加した `SUPABASE_SECRET_KEY` をRenderから削除する。SQLで作成したテーブルとRPCは自動削除しない。不要と確認できた後に別途削除する。

## Styling

This template comes with [Tailwind CSS](https://tailwindcss.com/) already configured for a simple default starting experience. You can use whatever CSS framework you prefer.

---

Built with ❤️ using React Router.
