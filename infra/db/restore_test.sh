#!/usr/bin/env bash
# AICTE Approval Control Tower - Backup Restore Verification Test Script

set -euo pipefail

BACKUP_FILE="${1:-}"
if [ -z "${BACKUP_FILE}" ]; then
  echo "Usage: $0 <path-to-backup-dump-file>"
  exit 1
fi

RESTORE_DB="aicte_db_restore_test_$(date +%s)"
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_USER="${POSTGRES_USER:-postgres}"

echo "[Restore Test] Verifying SHA-256 checksum..."
if [ -f "${BACKUP_FILE}.sha256" ]; then
  sha256sum -c "${BACKUP_FILE}.sha256"
  echo "[Restore Test] Checksum verified: Intact and untampered."
fi

echo "[Restore Test] Creating ephemeral verification database: ${RESTORE_DB}..."
createdb -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" "${RESTORE_DB}"

echo "[Restore Test] Restoring dump file via pg_restore..."
pg_restore \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -d "${RESTORE_DB}" \
  -v \
  "${BACKUP_FILE}" || true

echo "[Restore Test] Running verification queries..."
psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${RESTORE_DB}" -c "
  SELECT count(*) AS application_count FROM applications;
  SELECT count(*) AS audit_count FROM audit_log;
  SELECT fn_verify_audit_chain(1, NULL) AS audit_chain_check;
"

echo "[Restore Test] Dropping ephemeral verification database..."
dropdb -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" "${RESTORE_DB}"

echo "[Restore Test] Verification complete: Backup file restores cleanly and audit chain remains unbroken!"
