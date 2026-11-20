CREATE TABLE mikage.watch_result_batches (
  slot_start timestamptz PRIMARY KEY,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  saved_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON mikage.watch_result_batches FROM PUBLIC;
GRANT SELECT, INSERT ON mikage.watch_result_batches TO mikage_api;
GRANT INSERT ON mikage.logs TO mikage_api;
GRANT USAGE, SELECT ON SEQUENCE mikage.logs_id_seq TO mikage_api;

