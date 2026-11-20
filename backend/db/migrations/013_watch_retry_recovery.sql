ALTER TABLE mikage.watch_result_batches
  ADD COLUMN results jsonb;

ALTER TABLE mikage.incidents
  ADD COLUMN notification_pending boolean NOT NULL DEFAULT false;

DROP FUNCTION mikage.reserve_watch_run(timestamptz, boolean, text[]);

CREATE FUNCTION mikage.reserve_watch_run(
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
  v_retry_target_keys text[];
BEGIN
  IF COALESCE(cardinality(p_target_keys), 0) = 0 THEN
    SELECT COALESCE(array_agg(states.target_key ORDER BY states.target_key), ARRAY[]::text[])
    INTO v_retry_target_keys
    FROM mikage.watch_scheduler_lock AS scheduler_lock
    JOIN mikage.watch_target_states AS states
      ON states.last_reserved_at = scheduler_lock.last_reserved_slot
    WHERE scheduler_lock.singleton = true
      AND scheduler_lock.last_reserved_slot = p_slot_start;

    RETURN v_retry_target_keys;
  END IF;

  INSERT INTO mikage.watch_scheduler_lock (singleton, last_reserved_slot)
  VALUES (true, p_slot_start)
  ON CONFLICT (singleton) DO UPDATE
  SET last_reserved_slot = EXCLUDED.last_reserved_slot
  WHERE mikage.watch_scheduler_lock.last_reserved_slot < EXCLUDED.last_reserved_slot
  RETURNING last_reserved_slot INTO v_reserved_slot;

  IF NOT FOUND THEN
    SELECT COALESCE(array_agg(states.target_key ORDER BY states.target_key), ARRAY[]::text[])
    INTO v_retry_target_keys
    FROM mikage.watch_target_states AS states
    WHERE states.last_reserved_at = p_slot_start
      AND states.target_key = ANY(p_target_keys);

    RETURN v_retry_target_keys;
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

REVOKE ALL ON FUNCTION mikage.reserve_watch_run(timestamptz, boolean, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mikage.reserve_watch_run(timestamptz, boolean, text[]) TO mikage_api;
