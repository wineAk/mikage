import { mkdir, readFile, writeFile } from "node:fs/promises";

const before = JSON.parse(await readFile("performance-freshness-before.json", "utf8"));
const after = JSON.parse(await readFile("performance-freshness-after.json", "utf8"));
const database = JSON.parse(await readFile("performance-database-diagnostic.json", "utf8"));
const candidate = JSON.parse(await readFile("performance-error-query-parity.json", "utf8"));
const names = { "/": "ホーム", "/incidents": "インシデント", "/errors": "エラー", "/login": "ログイン" };

function stats(values) {
  const sorted = values.filter(Number.isFinite).sort((first, second) => first - second);
  return { count: sorted.length, min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1), samples: values };
}

function comparison(collection, field, predicate) {
  return {
    before: stats(before[collection].filter(predicate).map(item => item[field])),
    after: stats(after[collection].filter(predicate).map(item => item[field])),
  };
}

const report = {
  measuredAt: { before: before.timestamp, after: after.timestamp },
  environment: { browser: after.browser, viewport: "1440x1000", build: "ローカル本番ビルド", homeRangeMinutes: 60, trials: 5, cpuAndNetworkThrottling: false },
  freshness: { ttlResultCache: false, everyNavigationReadsDatabase: true, refreshIntervalWhenVisibleMs: 60_000, manualRefresh: true, onFocusOrVisible: true, onBackForwardCacheRestore: true, cacheControl: "private, no-store", inFlightDeduplication: "同一HTTP要求内のみ" },
  notes: [
    "比較前は画面データ15秒・対象一覧60秒のTTLを使用。比較後はTTLなし。再訪問の比較は鮮度条件が異なる。",
    "各試行のホームは新しいブラウザーcontext。続く直接表示は共通assetsを再利用。",
    "画面計測より先にAPIを各5回呼び出しているため、画面の読込値はDB完全コールド起動の値ではない。API初回値も別途保持。",
    "intentはホバー後150msを待ってからクリックを計測。変更後はデータ先読みを使用しない。directはホバーなし。",
    "表示完了はloadイベント、スピナー消失、navigation/revalidation完了、2フレーム確認。ブラウザー外の実画面提示完了を保証しない。",
    "Server-Timingのsupabase_*は通信を含むSupabase要求時間で、DB内部の純粋な実行時間ではない。",
    "実DB・OS負荷・GPU初期化・通信の変動を含む。最大値は今回の観測値で、本番配備後は未計測。",
    "DBの関数定義・実行計画・索引一覧を読む管理権限がなく、DB内部の変更は未適用。",
  ],
  pages: {},
  navigation: {},
  api: {},
  databaseDiagnostic: database,
  rejectedQueryCandidate: candidate,
  verification: { productionUnitTests: 12, assetDeliveryTests: 7, browserRegressionTests: 19, experimentalTests: 4, build: "passed", typecheck: "passed", independentReview: "重大指摘なし" },
};
for (const route of Object.keys(names)) {
  report.pages[route] = {};
  for (const field of ["readyMs", "ttfb", "fcp"]) report.pages[route][field] = comparison("pages", field, item => item.route === route);
  report.pages[route].serverTimings = after.pages.filter(item => item.route === route).map(item => item.serverTiming);
  report.navigation[route] = {};
  for (const mode of ["intent", "direct"]) report.navigation[route][mode] = comparison("transitions", "ms", item => item.route === route && item.mode === mode);
}
for (const route of [...new Set(before.api.map(item => item.route))]) report.api[route] = comparison("api", "ms", item => item.route === route);
report.failures = {
  before: { api: before.api.filter(item => item.hasError).length, page: before.pages.filter(item => !item.isReady || item.pageErrors.length).length },
  after: { api: after.api.filter(item => item.hasError).length, page: after.pages.filter(item => !item.isReady || item.pageErrors.length).length },
};

function format(value) { return value.toFixed(1); }
function row(name, value) { return `| ${name} | ${format(value.before.median)} | ${format(value.after.median)} | ${format(value.before.max)} | ${format(value.after.max)} |`; }
function table(rows) { return ["| 対象 | 変更前 中央値 | 変更後 中央値 | 変更前 最大 | 変更後 最大 |", "| --- | ---: | ---: | ---: | ---: |", ...rows].join("\n"); }
const maximumNavigation = Math.max(...Object.values(report.navigation).map(item => item.direct.after.max));
const candidateTrials = candidate.results.filter(item => item.iteration !== undefined);
const oldQuery = stats(candidateTrials.map(item => item.oldMs));
const newQuery = stats(candidateTrials.map(item => item.directMs));

const markdown = `# 最新データの取得を維持した速度改善結果

画面データのTTLキャッシュを廃止し、毎回DBから取得したデータを初回HTMLへ含める方式に変更しました。直接読込は短縮しましたが、初回読込を含む全項目の最大200msは未達です。DB内部のSQL・索引変更は未適用です。

## 直接読込を短縮し、最新データを初回HTMLへ含める

単位はms。追加改修直前のビルドと今回の最終ビルドを各5回測定しました。ブラウザーのloadイベント、データ表示、更新完了と2フレームを待っています。

${table(Object.entries(names).map(([route, name]) => row(name, report.pages[route].readyMs)))}

ホームは各試行で新しいブラウザーcontextを使用しました。続く3画面の直接表示では共通assetsを再利用しています。画面計測前にAPIを各5回呼んでいるため、これらはDB完全コールド起動を含む値ではありません。

## 再訪問もキャッシュで済ませず、毎回再取得する

次はホバーなしの再訪問です。変更前は15秒・60秒のTTLが有効で、変更後は毎回DBを読みます。鮮度条件が異なるため、変更後の所要時間増加もそのまま示します。

${table(Object.entries(names).map(([route, name]) => row(name, report.navigation[route].direct)))}

最新データを待った再訪問の観測最大は ${format(maximumNavigation)} ms でした。200msを超えた試行も除外していません。ホバー後150msの試行は、全サンプルJSONの \`navigation.intent\` に分けて保存しています。

画面は再訪問・期間変更・月変更・手動更新・フォーカス復帰・表示復帰・BFCache復帰で再取得します。表示中は60秒ごとに取得し、非表示中は定期取得を止めます。リアルタイムのプッシュ配信ではないため、開いたまま操作しない場合には最大約60秒と取得時間の反映待ちがあります。

HTTP応答は \`Cache-Control: private, no-store\` とし、利用者や別要求をまたぐ結果キャッシュは作りません。静的JavaScript・CSSのハッシュ付きキャッシュは維持しています。更新中を表示し、取得失敗時は古い成功結果を最新版として再表示せずエラーを通知します。

## DBは実測し、効果不足の代替案を採用しなかった

読取APIを測った値です。初回接続を除外していません。SQLロジックは変更していないため、この差をDB改修の効果とは扱いません。

${table(Object.entries(report.api).map(([route, value]) => row(route, value)))}

今回のAPIエラーは変更前 ${report.failures.before.api} 件、変更後 ${report.failures.after.api} 件、画面の未完了・例外は変更前 ${report.failures.before.page} 件、変更後 ${report.failures.after.page} 件でした。

別のDB診断では、0行を返す読取は約20〜55msでした。エラーログRPCは初回約3秒で \`57014\` のstatement timeoutを返しました。SQLの実行計画は406、カタログは404で取得できず、管理用CLIの認証もありません。通信を含む応答時間とDB内部の実行時間を混同しないよう、画面応答には \`Server-Timing\` を追加しました。

代替クエリは4か月分の全8列・前後月件数が既存結果と一致しました。しかし、5回の交互計測の中央値は ${format(oldQuery.median)} ms → ${format(newQuery.median)} ms、初回は ${format(candidate.results[0].oldMs)} ms → ${format(candidate.results[0].directMs)} ms で悪化しました。効果が不足するため本番コードには採用せず、検証用として \`experiments/\` に隔離しています。索引の不足など、未確認のSQL原因を断定して変更していません。

## 鮮度と既存機能の確認

外部フォント取得をなくしてOSフォントへ変更し、ナビゲーションの背景ぼかしを削減しました。

本体の単体テスト12件、圧縮配信7件、ブラウザー回帰19件、合計38件が通過しました。型検査、本番ビルド、独立レビューも完了しています。実験用の代替クエリ4件は本体の件数に含めていません。

ブラウザーテストではDB応答の値を更新し、即時再訪問・手動更新・60秒経過・画面復帰・戻る進むで新しい値へ変わることを確認しました。遅い旧応答が期間変更後の表示を上書きしないこと、取得失敗が正常な空結果にならないことも確認しています。UTCサーバーとPC・モバイルの画面で、SSRの日時表示とhydrationの一致を確認しました。

## 計測条件とデータ

Chrome ${after.browser}、1440×1000、CPU・ネットワーク制限なし、ローカル本番ビルドと既存Supabaseへの読取で測定しました。ホームは初期設定の1時間です。実DB・OS負荷・GPU初期化・通信の揺れを含む観測値で、本番配備後の速度は未確認です。

変更前ビルドは \`build-freshness-before/\` に保存しています。Nodeから使えるPlaywrightのパスを \`PLAYWRIGHT_MODULE\` に設定し、計測器の \`PERFORMANCE_BUILD\` を変更前は \`build-freshness-before\`、変更後は \`build\` に指定します。

\`node measure-performance.mjs freshness-before\` → \`node measure-performance.mjs freshness-after\` → \`node summarize-freshness.mjs\`

同名JSONに全サンプル、Server-Timing、DB診断と代替クエリ比較を保存しました。SQL・索引の内部改善を進めるには、対象DBの関数定義・既存索引・実行計画を取得できる管理アクセスが残る制約です。
`;
await mkdir("docs", { recursive: true });
await writeFile("docs/performance-freshness-2026-11-07.json", JSON.stringify(report, null, 2));
await writeFile("docs/performance-freshness-2026-11-07.md", markdown.replaceAll("\\`", "`"));
console.log(JSON.stringify({ pages: report.pages, navigation: report.navigation, failures: report.failures }, (key, value) => ["samples", "serverTimings"].includes(key) ? undefined : value, 2));
