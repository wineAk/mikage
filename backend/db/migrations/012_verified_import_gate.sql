CREATE TABLE mikage.migration_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  data_verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  CHECK ((data_verified AND verified_at IS NOT NULL) OR (NOT data_verified AND verified_at IS NULL))
);

INSERT INTO mikage.migration_state (singleton, data_verified, verified_at)
VALUES (true, false, NULL);

REVOKE ALL ON mikage.migration_state FROM PUBLIC;
GRANT SELECT ON mikage.migration_state TO mikage_api;
GRANT SELECT ON mikage.migration_state TO mikage_maintenance;
