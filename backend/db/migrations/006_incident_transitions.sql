CREATE TABLE mikage.incident_transition_batches (
  request_id text PRIMARY KEY,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  incident_id bigint,
  transition text NOT NULL CHECK (transition IN ('open', 'update', 'close')),
  saved_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON mikage.incident_transition_batches FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON mikage.incident_transition_batches TO mikage_api;
GRANT SELECT, INSERT, UPDATE ON mikage.incidents TO mikage_api;
GRANT USAGE, SELECT ON SEQUENCE mikage.incidents_id_seq TO mikage_api;
