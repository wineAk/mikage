#!/usr/bin/env bash
set -Eeuo pipefail
set +x

required_vars=(
  MIKAGE_SOURCE_PGHOST
  MIKAGE_SOURCE_PGUSER
  MIKAGE_SOURCE_PGPASSWORD
  POSTGRES_PASSWORD
)
for variable_name in "${required_vars[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    printf 'Required migration setting is missing: %s\n' "$variable_name" >&2
    exit 2
  fi
done

snapshot_id="${MIKAGE_SOURCE_SNAPSHOT_ID:-}"
if [[ -n "$snapshot_id" && ! "$snapshot_id" =~ ^[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+$ ]]; then
  printf 'Migration refused: exported PostgreSQL snapshot identifier is invalid.\n' >&2
  exit 2
fi
if [[ "${MIKAGE_SOURCE_WRITES_FROZEN:-}" != "true" && -z "$snapshot_id" ]]; then
  printf 'Migration refused: stop all source writers or provide a live exported PostgreSQL snapshot.\n' >&2
  exit 3
fi

source_port="${MIKAGE_SOURCE_PGPORT:-5432}"
source_database="${MIKAGE_SOURCE_PGDATABASE:-postgres}"
source_sslmode="${MIKAGE_SOURCE_PGSSLMODE:-verify-full}"
target_user="${POSTGRES_USER:-postgres}"
target_database="${POSTGRES_DB:-mikage}"

case "$source_sslmode" in
  verify-full) ;;
  *)
    printf 'Source TLS mode must verify the server certificate and hostname: verify-full.\n' >&2
    exit 2
    ;;
esac

if [[ -z "${MIKAGE_SOURCE_PGSSLROOTCERT_BASE64:-}" ]]; then
  printf 'MIKAGE_SOURCE_PGSSLROOTCERT_BASE64 must contain the Supabase root certificate.\n' >&2
  exit 2
fi

source_ca_file="$(mktemp "${TMPDIR:-/dev/shm}/mikage-supabase-root-ca.XXXXXX")"
trap 'rm -f "$source_ca_file"' EXIT
if ! printf '%s' "$MIKAGE_SOURCE_PGSSLROOTCERT_BASE64" | base64 -d > "$source_ca_file"; then
  printf 'Supabase root certificate could not be decoded.\n' >&2
  exit 2
fi
chmod 600 "$source_ca_file"
if command -v cygpath >/dev/null 2>&1; then
  export PGSSLROOTCERT="$(cygpath -aw "$source_ca_file")"
else
  export PGSSLROOTCERT="$source_ca_file"
fi

source_credentials=(
  --host="$MIKAGE_SOURCE_PGHOST"
  --port="$source_port"
  --username="$MIKAGE_SOURCE_PGUSER"
  --dbname="$source_database"
  --no-password
)
target_credentials=(
  --host=postgres
  --port=5432
  --username="$target_user"
  --dbname="$target_database"
  --no-password
)

source_rls_bypass_status="$(
  PGPASSWORD="$MIKAGE_SOURCE_PGPASSWORD" PGSSLMODE="$source_sslmode" \
    psql "${source_credentials[@]}" --no-psqlrc --quiet --tuples-only --no-align \
      --set=ON_ERROR_STOP=1 \
      --command="SELECT CASE WHEN rolsuper OR rolbypassrls THEN 'ok' ELSE 'missing' END FROM pg_roles WHERE rolname = current_user" \
    | tr -d '[:space:]'
)"
if [[ "$source_rls_bypass_status" != "ok" ]]; then
  printf 'Import refused: source role must bypass row-level security to guarantee a complete migration.\n' >&2
  exit 3
fi

target_state="$({
  PGPASSWORD="$POSTGRES_PASSWORD" psql "${target_credentials[@]}" \
    --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --command="SELECT
      (SELECT count(*) FROM mikage.targets),
      (SELECT count(*) FROM mikage.logs),
      (SELECT count(*) FROM mikage.incidents),
      (SELECT count(*) FROM mikage.watch_target_states),
      (SELECT count(*) FROM mikage.watch_scheduler_lock),
      (SELECT count(*) FROM mikage.watch_result_batches),
      (SELECT count(*) FROM mikage.incident_transition_batches),
      (SELECT count(*) FROM mikage.target_change_audit),
      (SELECT count(*) FROM mikage.page_cache_revision WHERE singleton AND epoch=0 AND revision=0),
      (SELECT count(*) FROM mikage.page_cache_revision),
      (SELECT count(*) FROM mikage.migration_state WHERE singleton AND NOT data_verified AND verified_at IS NULL),
      (SELECT count(*) FROM mikage.migration_state)"
} | tr -d '[:space:]')"
if [[ "$target_state" != "0|0|0|0|0|0|0|0|1|1|1|1" ]]; then
  printf 'Import refused: destination application tables must be empty and page cache revision pristine.\n' >&2
  exit 3
fi

target_sequence_status="$({
  PGPASSWORD="$POSTGRES_PASSWORD" psql "${target_credentials[@]}" \
    --no-psqlrc --quiet --tuples-only --no-align --set=ON_ERROR_STOP=1 <<'SQL' | tr -d '[:space:]'
SELECT CASE WHEN
  (SELECT last_value=1 AND NOT is_called FROM mikage.logs_id_seq)
  AND (SELECT last_value=1 AND NOT is_called FROM mikage.incidents_id_seq)
  AND (SELECT last_value=1 AND NOT is_called FROM mikage.target_change_audit_id_seq)
THEN 'fresh' ELSE 'used' END;
SQL
} )"
if [[ "$target_sequence_status" != "fresh" ]]; then
  printf 'Import refused: destination identity sequences must be unused.\n' >&2
  exit 3
fi

source_sequence_status="$(
  PGPASSWORD="$MIKAGE_SOURCE_PGPASSWORD" PGSSLMODE="$source_sslmode" \
    psql "${source_credentials[@]}" --no-psqlrc --quiet --tuples-only --no-align \
      --set=ON_ERROR_STOP=1 <<'SQL' | tr -d '[:space:]'
WITH sequence_state AS (
  SELECT
    (SELECT max(id) FROM mikage.logs) AS max_log_id,
    (SELECT last_value FROM mikage.logs_id_seq) AS log_value,
    (SELECT is_called FROM mikage.logs_id_seq) AS log_called,
    (SELECT max(id) FROM mikage.incidents) AS max_incident_id,
    (SELECT last_value FROM mikage.incidents_id_seq) AS incident_value,
    (SELECT is_called FROM mikage.incidents_id_seq) AS incident_called
)
SELECT CASE WHEN
  (max_log_id IS NULL OR log_value > max_log_id OR (log_value = max_log_id AND log_called))
  AND (max_incident_id IS NULL OR incident_value > max_incident_id OR (incident_value = max_incident_id AND incident_called))
THEN 'ok' ELSE 'invalid' END
FROM sequence_state;
SQL
)"
if [[ "$source_sequence_status" != "ok" ]]; then
  printf 'Import refused: a Supabase identity sequence can collide with existing row IDs.\n' >&2
  exit 3
fi

source_read_only_status="$(
  PGPASSWORD="$MIKAGE_SOURCE_PGPASSWORD" PGSSLMODE="$source_sslmode" \
    psql "${source_credentials[@]}" --no-psqlrc --quiet --tuples-only --no-align \
      --set=ON_ERROR_STOP=1 <<'SQL' | tr -d '[:space:]'
BEGIN READ ONLY;
SHOW transaction_read_only;
ROLLBACK;
SQL
)"
if [[ "$source_read_only_status" != "on" ]]; then
  printf 'Import refused: source session must be read-only.\n' >&2
  exit 3
fi

printf 'Streaming four application tables from Supabase into the empty Dokploy database using a read-only source session. No dump file is created.\n'
snapshot_arguments=()
if [[ -n "$snapshot_id" ]]; then
  snapshot_arguments+=("--snapshot=$snapshot_id")
fi
PGPASSWORD="$MIKAGE_SOURCE_PGPASSWORD" PGSSLMODE="$source_sslmode" \
  pg_dump "${source_credentials[@]}" \
    "${snapshot_arguments[@]}" \
    --format=custom --data-only --no-owner --no-privileges \
    --schema=mikage \
    --table=mikage.targets \
    --table=mikage.logs \
    --table=mikage.incidents \
    --table=mikage.watch_target_states \
    --table=mikage.logs_id_seq \
    --table=mikage.incidents_id_seq \
| PGPASSWORD="$POSTGRES_PASSWORD" pg_restore "${target_credentials[@]}" \
    --data-only --no-owner --no-privileges --exit-on-error --single-transaction

PGPASSWORD="$POSTGRES_PASSWORD" psql "${target_credentials[@]}" \
  --no-psqlrc --quiet --set=ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM mikage.logs_id_seq AS sequence_state
    WHERE sequence_state.last_value < COALESCE((SELECT max(id) FROM mikage.logs), 0)
       OR (sequence_state.last_value = (SELECT max(id) FROM mikage.logs) AND NOT sequence_state.is_called)
  ) THEN
    RAISE EXCEPTION 'logs identity sequence is behind imported data';
  END IF;
  IF EXISTS (
    SELECT 1 FROM mikage.incidents_id_seq AS sequence_state
    WHERE sequence_state.last_value < COALESCE((SELECT max(id) FROM mikage.incidents), 0)
       OR (sequence_state.last_value = (SELECT max(id) FROM mikage.incidents) AND NOT sequence_state.is_called)
  ) THEN
    RAISE EXCEPTION 'incidents identity sequence is behind imported data';
  END IF;
  IF EXISTS (
    SELECT 1 FROM mikage.logs AS logs
    LEFT JOIN mikage.targets AS targets ON targets.key = logs.target_key
    WHERE targets.key IS NULL
  ) OR EXISTS (
    SELECT 1 FROM mikage.watch_target_states AS states
    LEFT JOIN mikage.targets AS targets ON targets.key = states.target_key
    WHERE targets.key IS NULL
  ) THEN
    RAISE EXCEPTION 'imported rows contain foreign key orphans';
  END IF;
END;
$$;

SQL

printf 'Import completed. Run the independent migration verifier before connecting Render or starting either scheduler. Row contents and counts were not printed.\n'
