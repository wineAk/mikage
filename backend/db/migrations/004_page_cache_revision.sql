CREATE TABLE mikage.page_cache_revision (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  epoch bigint NOT NULL DEFAULT 0,
  revision bigint NOT NULL DEFAULT 0
);

INSERT INTO mikage.page_cache_revision (singleton, epoch, revision)
VALUES (true, 0, 0);

REVOKE ALL ON mikage.page_cache_revision FROM PUBLIC;
GRANT SELECT, UPDATE ON mikage.page_cache_revision TO mikage_api;
GRANT SELECT ON mikage.logs, mikage.incidents TO mikage_api;

CREATE OR REPLACE FUNCTION mikage.bump_page_cache_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE mikage.page_cache_revision
  SET epoch = CASE WHEN revision = 9223372036854775807 THEN epoch + 1 ELSE epoch END,
      revision = CASE WHEN revision = 9223372036854775807 THEN 0 ELSE revision + 1 END
  WHERE singleton = true;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION mikage.bump_page_cache_revision() FROM PUBLIC;

CREATE TRIGGER page_cache_revision_logs
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON mikage.logs
FOR EACH STATEMENT EXECUTE FUNCTION mikage.bump_page_cache_revision();

CREATE TRIGGER page_cache_revision_targets
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON mikage.targets
FOR EACH STATEMENT EXECUTE FUNCTION mikage.bump_page_cache_revision();

CREATE TRIGGER page_cache_revision_incidents
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON mikage.incidents
FOR EACH STATEMENT EXECUTE FUNCTION mikage.bump_page_cache_revision();
