ALTER TABLE mikage.incidents
  ALTER COLUMN keyword SET DEFAULT '''unknown''::text'::text,
  ALTER COLUMN count SET DEFAULT '1'::bigint;
