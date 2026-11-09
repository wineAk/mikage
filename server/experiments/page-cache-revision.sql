-- 不採用の実験用SQL。実環境へ適用しない。採用案は ../sql/page-cache-snapshot.sql。
BEGIN;

-- キャッシュの版はデータ更新と同じトランザクションで変更する。
-- 業務テーブルのRLSや既存権限は変更しない。
CREATE TABLE IF NOT EXISTS mikage.page_cache_revision (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  epoch text NOT NULL DEFAULT pg_catalog.gen_random_uuid()::text,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  trigger_fingerprint text
);

ALTER TABLE mikage.page_cache_revision
  ADD COLUMN IF NOT EXISTS trigger_fingerprint text;

INSERT INTO mikage.page_cache_revision (singleton, trigger_fingerprint)
VALUES (true, '')
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE mikage.page_cache_revision ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS page_cache_revision_read ON mikage.page_cache_revision;
CREATE POLICY page_cache_revision_read ON mikage.page_cache_revision
  FOR SELECT TO anon, authenticated USING (true);

-- この新設メタデータだけを書込不可とする。既存の業務テーブルには適用しない。
REVOKE ALL ON mikage.page_cache_revision FROM PUBLIC, anon, authenticated;
GRANT SELECT ON mikage.page_cache_revision TO anon, authenticated;

CREATE OR REPLACE FUNCTION mikage.bump_page_cache_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO mikage.page_cache_revision (singleton, revision, trigger_fingerprint)
  VALUES (true, 1, pg_catalog.md5(pg_catalog.pg_get_functiondef('mikage.bump_page_cache_revision()'::pg_catalog.regprocedure)))
  ON CONFLICT (singleton) DO UPDATE SET
    epoch = CASE
      WHEN mikage.page_cache_revision.revision = 9223372036854775807
        THEN pg_catalog.gen_random_uuid()::text
      ELSE mikage.page_cache_revision.epoch
    END,
    revision = CASE
      WHEN mikage.page_cache_revision.revision = 9223372036854775807 THEN 0
      ELSE mikage.page_cache_revision.revision + 1
    END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION mikage.bump_page_cache_revision() FROM PUBLIC, anon, authenticated;

-- 通常DMLでは業務行のロックより先に共通revision行を取得し、ロック順をそろえる。
-- 対象テーブルへの書込transactionは直列化される。明示的な行ロックやDDL/TRUNCATEは
-- relation lockを先に取得し得るため、別途一定のロック順を守る必要がある。
DROP TRIGGER IF EXISTS page_cache_revision_changed ON mikage.logs;
CREATE TRIGGER page_cache_revision_changed
  BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON mikage.logs
  FOR EACH STATEMENT EXECUTE FUNCTION mikage.bump_page_cache_revision();
ALTER TABLE mikage.logs ENABLE ALWAYS TRIGGER page_cache_revision_changed;

DROP TRIGGER IF EXISTS page_cache_revision_changed ON mikage.targets;
CREATE TRIGGER page_cache_revision_changed
  BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON mikage.targets
  FOR EACH STATEMENT EXECUTE FUNCTION mikage.bump_page_cache_revision();
ALTER TABLE mikage.targets ENABLE ALWAYS TRIGGER page_cache_revision_changed;

DROP TRIGGER IF EXISTS page_cache_revision_changed ON mikage.incidents;
CREATE TRIGGER page_cache_revision_changed
  BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON mikage.incidents
  FOR EACH STATEMENT EXECUTE FUNCTION mikage.bump_page_cache_revision();
ALTER TABLE mikage.incidents ENABLE ALWAYS TRIGGER page_cache_revision_changed;

-- トリガー関数の後付け変更も、安全に失効できない場合は利用停止する。
UPDATE mikage.page_cache_revision
SET trigger_fingerprint = pg_catalog.md5(
  pg_catalog.pg_get_functiondef('mikage.bump_page_cache_revision()'::pg_catalog.regprocedure)
);
ALTER TABLE mikage.page_cache_revision ALTER COLUMN trigger_fingerprint SET NOT NULL;

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
  revision_epoch text;
  revision_number bigint;
  expected_trigger_fingerprint text;
  definition_fingerprint text;
  policy_fingerprint text;
BEGIN
  -- 認証済み利用者や任意条件付きRLSは、アプリ側で毎回取得する。
  IF CURRENT_USER <> 'anon' THEN RETURN NULL; END IF;

  FOREACH relation_oid IN ARRAY ARRAY[
    'mikage.logs'::pg_catalog.regclass::oid,
    'mikage.targets'::pg_catalog.regclass::oid,
    'mikage.incidents'::pg_catalog.regclass::oid
  ] LOOP
    -- 子表への直接更新が親のstatement triggerを迂回する構成は対象外にする。
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class AS relation
      WHERE relation.oid = relation_oid AND relation.relkind = 'r'
    ) OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_inherits AS inheritance
      WHERE inheritance.inhparent = relation_oid OR inheritance.inhrelid = relation_oid
    ) THEN RETURN NULL; END IF;

    IF NOT pg_catalog.has_table_privilege(CURRENT_USER, relation_oid, 'SELECT') THEN
      RETURN NULL;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger AS trigger
      WHERE trigger.tgrelid = relation_oid
        AND trigger.tgname = 'page_cache_revision_changed'
        AND trigger.tgfoid = 'mikage.bump_page_cache_revision()'::pg_catalog.regprocedure
        AND trigger.tgenabled = 'A'
        AND trigger.tgtype = 62
        AND trigger.tgqual IS NULL
        AND trigger.tgnargs = 0
        AND NOT trigger.tgisinternal
    ) THEN RETURN NULL; END IF;

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

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'mikage'
      AND procedure.proname IN ('get_error_logs', 'get_logs_in_range')
      AND NOT pg_catalog.has_function_privilege(CURRENT_USER, procedure.oid, 'EXECUTE')
  ) THEN RETURN NULL; END IF;

  SELECT epoch, revision, trigger_fingerprint
  INTO revision_epoch, revision_number, expected_trigger_fingerprint
  FROM mikage.page_cache_revision WHERE singleton;
  IF revision_epoch IS NULL OR expected_trigger_fingerprint IS DISTINCT FROM pg_catalog.md5(
    pg_catalog.pg_get_functiondef('mikage.bump_page_cache_revision()'::pg_catalog.regprocedure)
  ) THEN RETURN NULL; END IF;

  SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
    procedure.oid::text || ':' || procedure.proowner::text || ':' || COALESCE(procedure.proacl::text, '') || ':' || pg_catalog.pg_get_functiondef(procedure.oid),
    E'\n' ORDER BY procedure.oid
  ), '')) INTO definition_fingerprint
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'mikage'
    AND procedure.proname IN ('get_error_logs', 'get_logs_in_range');

  SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
    relation.oid::text || ':' || relation.relrowsecurity::text || ':' || relation.relforcerowsecurity::text || ':' || COALESCE(relation.relacl::text, '') || ':' ||
    COALESCE(policy.polcmd::text, '') || ':' || COALESCE(policy.polpermissive::text, '') || ':' || COALESCE(policy.polroles::text, '') || ':' ||
    COALESCE(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '') || ':' || COALESCE(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), ''),
    E'\n' ORDER BY relation.oid, policy.oid
  ), '')) INTO policy_fingerprint
  FROM pg_catalog.pg_class AS relation
  LEFT JOIN pg_catalog.pg_policy AS policy ON policy.polrelid = relation.oid
  WHERE relation.oid IN ('mikage.logs'::pg_catalog.regclass, 'mikage.targets'::pg_catalog.regclass, 'mikage.incidents'::pg_catalog.regclass);

  RETURN revision_epoch || ':' || revision_number::text || ':' || definition_fingerprint || ':' || policy_fingerprint;
END;
$$;

REVOKE ALL ON FUNCTION mikage.get_page_cache_revision() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mikage.get_page_cache_revision() TO anon, authenticated;

COMMIT;
