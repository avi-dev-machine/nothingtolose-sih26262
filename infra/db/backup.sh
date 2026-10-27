#!/usr/bin/env bash
# AICTE Approval Control Tower - Database Backup Script
# Conforms to Digital Personal Data Protection Act (DPDP) and AICTE Regulation guidelines.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/aicte_db_${TIMESTAMP}.dump"
CHECKSUM_FILE="${BACKUP_FILE}.sha256"

DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_NAME="${POSTGRES_DB:-aicte_db}"
DB_USER="${POSTGRES_USER:-postgres}"

mkdir -p "${BACKUP_DIR}"

echo "[AICTE Backup] Starting backup of database '${DB_NAME}' at ${TIMESTAMP}..."

# 1. Execute pg_dump with custom compressed archive format
pg_dump \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -F c \
  -b \
  -v \
  -f "${BACKUP_FILE}" \
  "${DB_NAME}"

# 2. Compute SHA-256 Checksum for tamper evidence
sha256sum "${BACKUP_FILE}" > "${CHECKSUM_FILE}"
echo "[AICTE Backup] Backup completed successfully: ${BACKUP_FILE}"
echo "[AICTE Backup] Tamper-evident checksum written to: ${CHECKSUM_FILE}"

# 3. WAL Archiving Note for Point-In-Time-Recovery (PITR)
echo "======================================================================"
echo "WAL Archiving Guidance for Point-In-Time Recovery (PITR):"
echo "Configure the following in postgresql.conf for full PITR:"
echo "  wal_level = replica"
echo "  archive_mode = on"
echo "  archive_command = 'test ! -f /mnt/wal_archive/%f && cp %p /mnt/wal_archive/%f'"
echo "  archive_timeout = 300 # forces WAL switch every 5 minutes"
echo "======================================================================"
