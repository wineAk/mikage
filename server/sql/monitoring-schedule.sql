CREATE TABLE IF NOT EXISTS mikage.watch_scheduler_lock (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_reserved_slot timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS mikage.watch_target_states (
  target_key text PRIMARY KEY REFERENCES mikage.targets (key) ON DELETE CASCADE,
  last_reserved_at timestamptz,
  last_checked_at timestamptz,
  first_failed_at timestamptz,
  failure_confirmed_at timestamptz,
  response_time double precision,
  status_code integer,
  status_message text,
  error_name text,
  error_code text
);

ALTER TABLE mikage.watch_scheduler_lock ENABLE ROW LEVEL SECURITY;
ALTER TABLE mikage.watch_target_states ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA mikage TO service_role;

CREATE OR REPLACE FUNCTION mikage.reserve_watch_run(
  p_slot_start timestamptz,
  p_is_full_run boolean,
  p_target_keys text[]
)
RETURNS text[]
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_reserved_slot timestamptz;
  v_target_key text;
BEGIN
  INSERT INTO mikage.watch_scheduler_lock (singleton, last_reserved_slot)
  VALUES (true, p_slot_start)
  ON CONFLICT (singleton) DO UPDATE
  SET last_reserved_slot = EXCLUDED.last_reserved_slot
  WHERE mikage.watch_scheduler_lock.last_reserved_slot < EXCLUDED.last_reserved_slot
  RETURNING last_reserved_slot INTO v_reserved_slot;

  IF NOT FOUND THEN
    RETURN ARRAY[]::text[];
  END IF;

  IF p_is_full_run THEN
    INSERT INTO mikage.watch_target_states (target_key, last_reserved_at)
    SELECT keys.target_key, p_slot_start
    FROM unnest(p_target_keys) AS keys(target_key)
    ON CONFLICT (target_key) DO UPDATE
    SET last_reserved_at = EXCLUDED.last_reserved_at;

    RETURN p_target_keys;
  END IF;

  SELECT candidates.target_key
  INTO v_target_key
  FROM unnest(p_target_keys) AS candidates(target_key)
  LEFT JOIN mikage.watch_target_states AS states
    ON states.target_key = candidates.target_key
  ORDER BY
    (
      states.first_failed_at IS NOT NULL
      AND states.failure_confirmed_at IS NULL
      AND states.first_failed_at <= p_slot_start - INTERVAL '5 minutes'
      AND states.last_reserved_at <= p_slot_start - INTERVAL '5 minutes'
    ) DESC,
    GREATEST(
      COALESCE(states.last_checked_at, '-infinity'::timestamptz),
      COALESCE(states.last_reserved_at, '-infinity'::timestamptz)
    ) ASC,
    candidates.target_key ASC
  LIMIT 1;

  IF v_target_key IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;

  INSERT INTO mikage.watch_target_states (target_key, last_reserved_at)
  VALUES (v_target_key, p_slot_start)
  ON CONFLICT (target_key) DO UPDATE
  SET last_reserved_at = EXCLUDED.last_reserved_at;

  RETURN ARRAY[v_target_key];
END;
$$;

REVOKE ALL ON TABLE mikage.watch_scheduler_lock FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE mikage.watch_target_states FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE mikage.watch_scheduler_lock TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE mikage.watch_target_states TO service_role;

REVOKE ALL ON FUNCTION mikage.reserve_watch_run(timestamptz, boolean, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mikage.reserve_watch_run(timestamptz, boolean, text[]) TO service_role;
