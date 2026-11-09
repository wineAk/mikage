-- 既存get_error_logsの本文・出力・権限を変えず、エラー行の期間検索を小さな索引へ限定する。
-- CONCURRENTLYを使うため、BEGIN/COMMITで囲まずに実行する。
-- 条件は既存RPCと同じ。NULLのstatus_codeも対象とし、NO_INTERNETを除外する。
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_logs_error_created_at
ON mikage.logs USING btree (created_at)
WHERE (
  status_code IS DISTINCT FROM 200
  OR status_code IS NULL
  OR error_code IS NOT NULL
)
AND error_code IS DISTINCT FROM 'NO_INTERNET';
