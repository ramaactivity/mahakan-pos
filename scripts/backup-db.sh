#!/usr/bin/env bash
# Local manual Postgres dump — same format as the GitHub Actions backup
# (custom format -Fc, compressed). Output goes to ./backups/.
#
# Usage:
#   ./scripts/backup-db.sh                # uses DATABASE_URL from .env.local
#   DATABASE_URL=postgres://... ./scripts/backup-db.sh
#
# Restore later via:
#   pg_restore --no-owner --clean --if-exists -d "$TARGET_DB_URL" mahakan-pos-...dump

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

# Load DATABASE_URL from .env.local if not already set.
if [ -z "${DATABASE_URL:-}" ] && [ -f ".env.local" ]; then
  # shellcheck disable=SC2046
  export $(grep -E '^DATABASE_URL=' .env.local | xargs)
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL not set (and not found in .env.local)" >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump not found in PATH. Install postgresql-client (e.g. 'brew install libpq && brew link libpq --force')." >&2
  exit 1
fi

mkdir -p backups
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="backups/mahakan-pos-${STAMP}.dump"

echo "→ Dumping to ${OUT} ..."
pg_dump --format=custom --no-owner --no-privileges \
  --file="${OUT}" "${DATABASE_URL}"

ls -lh "${OUT}"
echo "✓ Done. Restore with: pg_restore --no-owner --clean --if-exists -d <target> ${OUT}"
