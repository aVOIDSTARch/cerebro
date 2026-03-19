#!/bin/bash
# Cerebro backup script
# Run nightly via cron: 0 2 * * * /srv/cerebro/scripts/backup.sh

set -euo pipefail

CEREBRO_DIR="${CEREBRO_DIR:-/srv/cerebro}"
BACKUP_BASE="${BACKUP_BASE:-/backups/cerebro}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_BASE}/${TIMESTAMP}"
MEILI_KEY="${MEILI_KEY:-}"
MEILI_HOST="${MEILI_HOST:-http://localhost:7700}"

echo "Starting Cerebro backup: ${TIMESTAMP}"

mkdir -p "${BACKUP_DIR}"

# 1. Kùzu database
if [ -d "${CEREBRO_DIR}/cerebro.db" ]; then
  echo "  Backing up Kùzu..."
  cp -r "${CEREBRO_DIR}/cerebro.db" "${BACKUP_DIR}/cerebro.db"
fi

# 2. Quarantine SQLite
if [ -f "${CEREBRO_DIR}/quarantine.db" ]; then
  echo "  Backing up quarantine SQLite..."
  cp "${CEREBRO_DIR}/quarantine.db" "${BACKUP_DIR}/quarantine.db"
fi

# 3. Chroma data
if [ -d "${CEREBRO_DIR}/chroma_data" ]; then
  echo "  Backing up Chroma..."
  cp -r "${CEREBRO_DIR}/chroma_data" "${BACKUP_DIR}/chroma_data"
fi

# 4. Meilisearch dump
if [ -n "${MEILI_KEY}" ]; then
  echo "  Creating Meilisearch dump..."
  curl -s -X POST "${MEILI_HOST}/dumps" \
    -H "Authorization: Bearer ${MEILI_KEY}" \
    -o "${BACKUP_DIR}/meili_dump_response.json" 2>/dev/null || \
    echo "  Warning: Meilisearch dump failed"
fi

# Compress
echo "  Compressing..."
tar czf "${BACKUP_BASE}/${TIMESTAMP}.tar.gz" -C "${BACKUP_BASE}" "${TIMESTAMP}"
rm -rf "${BACKUP_DIR}"

# Prune old backups (keep 7 days)
echo "  Pruning old backups..."
find "${BACKUP_BASE}" -name "*.tar.gz" -mtime +7 -delete 2>/dev/null || true

echo "Backup complete: ${BACKUP_BASE}/${TIMESTAMP}.tar.gz"
