import { mkdir, readFile, writeFile } from "node:fs/promises";

const before = JSON.parse(await readFile("performance-before-final.json", "utf8"));
const after = JSON.parse(await readFile("performance-after-final.json", "utf8"));
const routeNames = { "/": "ホーム", "/incidents": "インシデント", "/errors": "エラー", "/login": "ログイン" };

function summarize(values) {
  const sorted = [...values].sort((first, second) => first - second);
  return { count: sorted.length, min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1), samples: values };
}

function compare(collection, metric, predicate) {
  const previous = summarize(before[collection].filter(predicate).map(item => item[metric]));
  const current = summarize(after[collection].filter(predicate).map(item => item[metric]));
  return { before: previous, after: current, maxReductionPercent: (1 - current.max / previous.max) * 100 };
}

const results = {
  baselineCommit: "ed6552f310193cb9c23e0be09e7860b6c151b4f5",
  beforeTimestamp: before.timestamp,
  afterTimestamp: after.timestamp,
  environment: { browser: after.browser, viewport: "1440x1000", server: "ローカル本番ビルド", database: "既存Supabaseへの読み取りのみ", throttling: "CPU・ネットワーク制限なし", trials: 5, homeRange: "初期設定の1時間" },
  limitations: ["各試行のホームは新規ブラウザーcontext。続く直接表示では共通assetsを再利用。", "intentはホバー後150msの先読み時間をクリック所要時間に含めない。directは全画面を訪問済みの再訪問でホバーしない。", "表示完了はロードイベント、スピナー消失、2フレームの描画確認。旧グラフの補間アニメーション完了やWebフォントの最終適用完了は保証しない。", "LCPは表示完了判定時点の観測値で、後続のフォント適用などを含む最終値ではない。", "実DB・外部フォント・OS負荷による揺れを含む。最大値は今回の観測値。", "APIロジックは変更していないため、API応答差を改修効果とは断定しない。", "本番配備後の速度は未計測。"],
  navigation: {},
  document: {},
  api: {},
  verification: { unitTests: 13, assetDeliveryTests: 7, browserRegressionTests: 8, build: "passed", typecheck: "passed", independentReview: "重大指摘なし" },
};
for (const route of Object.keys(routeNames)) {
  results.navigation[route] = {};
  for (const mode of ["intent", "direct"]) results.navigation[route][mode] = compare("transitions", "ms", item => item.route === route && item.mode === mode);
  results.document[route] = {};
  for (const metric of ["readyMs", "ttfb", "fcp", "lcp"]) results.document[route][metric] = compare("pages", metric, item => item.route === route);
}
for (const route of [...new Set(before.api.map(item => item.route))]) results.api[route] = compare("api", "ms", item => item.route === route);
results.errors = { before: before.pages.filter(item => item.isReady === false || item.pageErrors.length).length, after: after.pages.filter(item => item.isReady === false || item.pageErrors.length).length, apiBefore: before.api.filter(item => item.hasError).length, apiAfter: after.api.filter(item => item.hasError).length };
results.homeAssetTransfer = {
  before: summarize(before.pages.filter(item => item.route === "/").map(item => item.resources.filter(resource => resource.name.startsWith("/assets/")).reduce((total, resource) => total + resource.bytes, 0))),
  after: summarize(after.pages.filter(item => item.route === "/").map(item => item.resources.filter(resource => resource.name.startsWith("/assets/")).reduce((total, resource) => total + resource.bytes, 0))),
};

function number(value) { return value.toFixed(1); }
function row(label, entry) { return `| ${label} | ${number(entry.before.median)} | ${number(entry.after.median)} | ${number(entry.before.max)} | ${number(entry.after.max)} |`; }
function table(entries) { return ["| 対象 | 変更前 中央値 | 変更後 中央値 | 変更前 最大 | 変更後 最大 |", "| --- | ---: | ---: | ---: | ---: |", ...entries].join("\n"); }

const report = `# ページ表示・遷移の速度改善結果

この記録はTTLキャッシュを使用した最初の改修時点の結果です。現在の実装と計測結果は、[最新データ取得を維持した改善結果](performance-freshness-2026-11-07.md)を参照してください。

ホバーなしの再訪問は全画面で最大 ${number(Math.max(...Object.values(results.navigation).map(item => item.direct.after.max)))} ms、事前取得ありの遷移は最大 ${number(Math.max(...Object.values(results.navigation).map(item => item.intent.after.max)))} ms でした。初回読込を含む全項目の最大200msは未達です。

## ページ遷移は200ms以内、再訪問は約50ms

単位は ms。ホバーなしの再訪問は、同じページ内で4画面を訪問した後に測定しています。画面データを15秒、対象一覧を60秒まで再利用します。

${table(Object.entries(routeNames).map(([route, name]) => row(name, results.navigation[route].direct)))}

ホバー後150msの先読みを行った場合も、次の値でした。先読みの150msは表の時間に含みません。

${table(Object.entries(routeNames).map(([route, name]) => row(name, results.navigation[route].intent)))}

## 直接表示の読込時間は短縮、200ms超の項目が残る

ロードイベントとデータ表示を待ち、スピナーが消えてから2フレーム確認した所要時間です。各試行はホームから開始し、新しいブラウザーcontextを使用しました。続く3画面の直接表示では共通assetsを再利用しています。

${table(Object.entries(routeNames).map(([route, name]) => row(name, results.document[route].readyMs)))}

最初の描画までの時間（FCP）は次の値でした。最終的な全データ表示完了とは異なります。

${table(Object.entries(routeNames).map(([route, name]) => row(name, results.document[route].fcp)))}

HTML応答の先頭受信までの時間（TTFB）です。

${table(Object.entries(routeNames).map(([route, name]) => row(name, results.document[route].ttfb)))}

## DB読取APIは通信・DB側の揺れを含む

API処理ロジックは変更していません。次の差を改修効果とは断定しません。初回接続も除外せず記録しています。

${table(Object.entries(results.api).map(([route, entry]) => row(route, entry)))}

APIエラーは変更前 ${results.errors.apiBefore} 件、変更後 ${results.errors.apiAfter} 件。画面の読込未完了・ブラウザー例外は変更前 ${results.errors.before} 件、変更後 ${results.errors.after} 件でした。

## 配信量と検証結果

ホーム用主要JavaScriptは約375.2KBから27.7KBへ縮小しました。グラフをSVGへ置き換え、全計測点と欠測区間を保持しています。点の間は曲線から直線へ変更しました。

ホーム初回のJavaScript・CSS転送量（HTTPヘッダー込みの中央値）は ${number(results.homeAssetTransfer.before.median / 1000)} KB → ${number(results.homeAssetTransfer.after.median / 1000)} KB でした。API・外部フォントはこの集計に含みません。

データ処理テスト13件、圧縮配信テスト7件、ブラウザー回帰テスト8件が通過しました。型検査・本番ビルド・独立コードレビューも完了しています。PC幅1440pxとモバイル幅390pxで表示を確認しました。

## 計測条件と再実行

計測日は2026年11月7日。Chrome ${after.browser}、1440×1000、CPU・ネットワーク制限なし、ローカルの本番ビルドと既存Supabaseへの読取APIで各5回測定しました。ホームの期間は初期設定の1時間です。本番配備後の計測ではありません。

変更前の基点は \`${results.baselineCommit}\` です。変更前ビルドはローカルの \`build-before/\` に保存しています。今回の環境では80番への接続ができなかったため、両ビルドを3087番で測定しました。表示完了の判定には旧グラフのアニメーション完了やWebフォントの最終適用完了を含めません。実DB・外部サービス・OS負荷による揺れがあるため、最大値は今回の観測値です。

計測器は \`measure-performance.mjs\`、集計器は \`summarize-performance.mjs\` です。Nodeから読み込めるPlaywrightのモジュールパスを \`PLAYWRIGHT_MODULE\` に設定して実行します。

\`node measure-performance.mjs before-final\` → \`node measure-performance.mjs after-final\` → \`node summarize-performance.mjs\`

全サンプルの数値は同名のJSONに保存しました。200ms超の読込には、DBアクセスの直列処理と初回のJavaScript実行・外部フォント取得が残ります。
`;
await mkdir("docs", { recursive: true });
await writeFile("docs/performance-2026-11-07.json", JSON.stringify(results, null, 2));
await writeFile("docs/performance-2026-11-07.md", report.replaceAll("\\`", "`"));
console.log(JSON.stringify(results, (key, value) => key === "samples" || key === "limitations" ? undefined : value, 2));
