#!/usr/bin/env bash
# Backup lógico do Postgres (pg_dump). Os dados em volumes/ já persistem em disco;
# este script é uma cópia extra para recuperação ou migração.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${SUPABASE_INSTALL_DIR:-$SCRIPT_DIR/project}"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="$BACKUP_DIR/rent_finder-${STAMP}.sql.gz"

if [[ ! -d "$INSTALL_DIR" ]]; then
  echo "Instalação não encontrada em $INSTALL_DIR"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

cd "$INSTALL_DIR"

echo "==> Backup para $OUT_FILE"
docker compose exec -T db pg_dump -U postgres -d postgres --no-owner --no-acl | gzip > "$OUT_FILE"

echo "==> OK ($(du -h "$OUT_FILE" | cut -f1))"
