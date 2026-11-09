# エラーログの代替クエリ検証

## 不採用の版管理方式

`page-cache-revision.sql` と `test-cache-revision.mjs` は、トリガーで共通の版管理行を更新する初期案です。追加の書込ロックを避けるため採用していません。実 DB には適用していません。採用案は `../sql/page-cache-snapshot.sql` と `../test-cache-snapshot.mjs` です。

## 代替クエリ

`logWindow.ts` とそのテストは、生ログの取得窓を広げて再利用する案の検討用です。既存 RPC の集計・空欄補完の仕様を確認できていないため、本体には使っていません。

このディレクトリの取得処理は本体には採用していません。既存RPCを維持しています。

JST月境界で4か月分の全8列・前後月件数を照合し、一致を確認しました。ただしSQL定義を取得できておらず、全条件で同じ仕様とは証明していません。

5回の交互計測では中央値120.3msから117.2msへの差にとどまり、初回は284.2msから770.7msへ悪化しました。3並列要求の初期接続コストを含めると採用根拠が弱いため、検証用として残しています。

`server` ディレクトリから次を実行できます。比較は読取専用で、認証値・URL・実レコードを出力しません。

```powershell
node --test experiments/errorPageQuery.test.mjs
node experiments/validate-error-page.mjs
```
