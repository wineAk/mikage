BEGIN;

-- 業務テーブルへトリガーや共通ロックを追加せず、DBのMVCC snapshotを版とする。
-- DB内の無関係な書込も失効要因になるが、更新の取りこぼしを避ける。
-- 有効化前に、既存RPCと呼出先関数の本文を管理権限で確認する。
-- 一時表作成・監査書込などを行う関数を、確認せずSTABLEへ変更してはいけない。
-- STABLE属性だけで結果の不変性は証明できない。呼出先も含め、時刻・JWT・session設定・外部データに
-- 依存する出力がキャッシュキーで区別されることを確認する。metadataとdataの接続設定も統一する。
-- このSQLは既存関数を変更せず、VOLATILEならNULLを返して通常の再取得へ戻す。
-- 版の確認とデータ取得は同じprimary DBへ接続すること。lagのある別DBとの混在は対象外。
CREATE OR REPLACE FUNCTION mikage.get_page_cache_revision()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  relation_oid oid;
  has_open_policy boolean;
  has_restrictive_policy boolean;
BEGIN
  IF CURRENT_USER <> 'anon' OR pg_catalog.pg_is_in_recovery() THEN RETURN NULL; END IF;
  -- pre-request処理等が自身の要求で書込んだ場合、自己失効を繰り返さない。
  IF pg_catalog.pg_current_xact_id_if_assigned() IS NOT NULL THEN RETURN NULL; END IF;

  FOREACH relation_oid IN ARRAY ARRAY[
    'mikage.logs'::pg_catalog.regclass::oid,
    'mikage.targets'::pg_catalog.regclass::oid,
    'mikage.incidents'::pg_catalog.regclass::oid
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class AS relation
      WHERE relation.oid = relation_oid AND relation.relkind = 'r'
    ) OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_inherits AS inheritance
      WHERE inheritance.inhparent = relation_oid OR inheritance.inhrelid = relation_oid
    ) THEN RETURN NULL; END IF;

    IF NOT pg_catalog.has_table_privilege(CURRENT_USER, relation_oid, 'SELECT') THEN RETURN NULL; END IF;

    IF pg_catalog.row_security_active(relation_oid) THEN
      SELECT
        COALESCE(pg_catalog.bool_or(policy.polpermissive AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) IN ('true', '(true)')), false),
        COALESCE(pg_catalog.bool_or(NOT policy.polpermissive), false)
      INTO has_open_policy, has_restrictive_policy
      FROM pg_catalog.pg_policy AS policy
      WHERE policy.polrelid = relation_oid
        AND policy.polcmd IN ('r', '*')
        AND EXISTS (
          SELECT 1 FROM pg_catalog.unnest(policy.polroles) AS allowed_role(role_oid)
          WHERE CASE WHEN allowed_role.role_oid = 0 THEN true
            ELSE pg_catalog.pg_has_role(CURRENT_USER, allowed_role.role_oid, 'MEMBER') END
        );
      IF NOT has_open_policy OR has_restrictive_policy THEN RETURN NULL; END IF;
    END IF;
  END LOOP;

  -- VOLATILEの既存RPCは、SQL定義を確認してから管理者が別途判断する。
  -- このmigrationは既存関数の属性や本文、権限を変更しない。
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'mikage'
      AND procedure.proname IN ('get_error_logs', 'get_logs_in_range')
      AND (procedure.prokind <> 'f' OR procedure.provolatile = 'v'
        OR NOT pg_catalog.has_function_privilege(CURRENT_USER, procedure.oid, 'EXECUTE'))
  ) THEN RETURN NULL; END IF;

  -- active XID一覧も含むため、開始順とcommit順が逆でも変更を検知する。
  -- サーバー起動時刻も含め、再起動・復旧後に古い版を再利用しない。
  -- JSTの月替わりと出力設定の違いも、DB更新がなくても別の版として扱う。
  RETURN 'snapshot:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(
      pg_catalog.current_database(),
      EXTRACT(EPOCH FROM pg_catalog.pg_postmaster_start_time()),
      pg_catalog.pg_current_snapshot()::text,
      pg_catalog.to_char(pg_catalog.date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo'), 'YYYY-MM'),
      pg_catalog.current_setting('TimeZone'),
      pg_catalog.current_setting('DateStyle'),
      pg_catalog.current_setting('IntervalStyle'),
      pg_catalog.current_setting('extra_float_digits')
    )::text, 'UTF8'
  )), 'hex');
END;
$$;

REVOKE ALL ON FUNCTION mikage.get_page_cache_revision() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mikage.get_page_cache_revision() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
