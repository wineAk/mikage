#!/usr/bin/env bash
set -Eeuo pipefail
set +x

required_vars=(MIKAGE_SOURCE_PGHOST MIKAGE_SOURCE_PGUSER MIKAGE_SOURCE_PGPASSWORD MIKAGE_SOURCE_PGSSLROOTCERT_BASE64)
for variable_name in "${required_vars[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    printf 'Required snapshot setting is missing: %s\n' "$variable_name" >&2
    exit 2
  fi
done

snapshot_ca_file="$(mktemp "${TMPDIR:-/dev/shm}/mikage-supabase-snapshot-ca.XXXXXX")"
trap 'rm -f "$snapshot_ca_file"' EXIT
if ! printf '%s' "$MIKAGE_SOURCE_PGSSLROOTCERT_BASE64" | base64 -d > "$snapshot_ca_file"; then
  printf 'Supabase root certificate could not be decoded.\n' >&2
  exit 2
fi
chmod 600 "$snapshot_ca_file"
if command -v cygpath >/dev/null 2>&1; then
  export PGSSLROOTCERT="$(cygpath -aw "$snapshot_ca_file")"
else
  export PGSSLROOTCERT="$snapshot_ca_file"
fi

PGPASSWORD="$MIKAGE_SOURCE_PGPASSWORD" \
PGSSLMODE=verify-full \
psql \
  --host="$MIKAGE_SOURCE_PGHOST" \
  --port="${MIKAGE_SOURCE_PGPORT:-5432}" \
  --username="$MIKAGE_SOURCE_PGUSER" \
  --dbname="${MIKAGE_SOURCE_PGDATABASE:-postgres}" \
  --no-password \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1
