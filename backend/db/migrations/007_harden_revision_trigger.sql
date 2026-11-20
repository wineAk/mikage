REVOKE UPDATE ON mikage.page_cache_revision FROM mikage_api;

CREATE OR REPLACE FUNCTION mikage.bump_page_cache_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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
ALTER FUNCTION mikage.bump_page_cache_revision() OWNER TO CURRENT_USER;
