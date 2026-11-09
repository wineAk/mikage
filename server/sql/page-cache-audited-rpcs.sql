BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '5s';
SET LOCAL TimeZone = 'UTC';
SET LOCAL DateStyle = 'ISO, MDY';

-- 監査した本文と一致する場合だけ属性を変更する。業務データと既存権限は変更しない。
DO $migration$
DECLARE
  target_keys text[];
  window_end timestamp := date_trunc('minute', current_timestamp AT TIME ZONE 'UTC');
  month_offset integer;
  period_minutes integer;
  errors_before jsonb[] := ARRAY[]::jsonb[];
  errors_after jsonb[] := ARRAY[]::jsonb[];
  logs_before jsonb[] := ARRAY[]::jsonb[];
  logs_after jsonb[] := ARRAY[]::jsonb[];
  normalized_logs jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = 'mikage.get_error_logs(integer,integer)'::regprocedure
      AND encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') = '750cdc22e1da19a39b8241f725c166c1737a569e92c8e450970c904699b9a876'
      AND NOT prosecdef
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = 'mikage.get_logs_in_range(text[],timestamp without time zone,timestamp without time zone)'::regprocedure
      AND encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') = '54d6a3cad92949f7de497c14d06ff0f0405cb24e0e3ee56353752a227a15d506'
      AND NOT prosecdef
  ) THEN
    RAISE EXCEPTION '監査したRPC本文と一致しないため、変更を中止しました。';
  END IF;

  SELECT array_agg(key ORDER BY key) INTO target_keys FROM mikage.targets;
  FOREACH month_offset IN ARRAY ARRAY[0, 1, 120] LOOP
    errors_before := array_append(errors_before, mikage.get_error_logs(month_offset, month_offset - 1));
  END LOOP;
  FOREACH period_minutes IN ARRAY ARRAY[60, 1440, 40320] LOOP
    SELECT jsonb_agg(value ORDER BY value->>'key') INTO normalized_logs
    FROM jsonb_array_elements(mikage.get_logs_in_range(target_keys, window_end - make_interval(mins => period_minutes), window_end));
    logs_before := array_append(logs_before, normalized_logs);
  END LOOP;

  -- 本文はSELECT・組込関数のみと確認済み。相対月と日時の出力設定を固定する。
  ALTER FUNCTION mikage.get_error_logs(integer, integer) STABLE
    SET TimeZone TO 'UTC' SET DateStyle TO 'ISO, MDY';
  ALTER FUNCTION mikage.get_logs_in_range(text[], timestamp without time zone, timestamp without time zone) STABLE
    SET TimeZone TO 'UTC' SET DateStyle TO 'ISO, MDY';

  FOREACH month_offset IN ARRAY ARRAY[0, 1, 120] LOOP
    errors_after := array_append(errors_after, mikage.get_error_logs(month_offset, month_offset - 1));
  END LOOP;
  FOREACH period_minutes IN ARRAY ARRAY[60, 1440, 40320] LOOP
    SELECT jsonb_agg(value ORDER BY value->>'key') INTO normalized_logs
    FROM jsonb_array_elements(mikage.get_logs_in_range(target_keys, window_end - make_interval(mins => period_minutes), window_end));
    logs_after := array_append(logs_after, normalized_logs);
  END LOOP;

  IF errors_before IS DISTINCT FROM errors_after OR logs_before IS DISTINCT FROM logs_after THEN
    RAISE EXCEPTION 'RPCの変更前後で結果が一致しないため、変更を中止しました。';
  END IF;
END;
$migration$;
NOTIFY pgrst, 'reload schema';
COMMIT;
