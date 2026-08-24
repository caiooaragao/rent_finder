#!/usr/bin/env bash
# Gestão da instância Supabase do Rent Finder.
# Uso: ./manage.sh {start|stop|status|logs|secrets|backup|url}
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${SUPABASE_INSTALL_DIR:-$SCRIPT_DIR/project}"

if [[ ! -d "$INSTALL_DIR" ]]; then
  echo "Instalação não encontrada em $INSTALL_DIR"
  echo "Execute primeiro: ./setup.sh"
  exit 1
fi

cd "$INSTALL_DIR"

cmd="${1:-status}"

case "$cmd" in
  start)
    sh run.sh start
    ;;
  stop)
    sh run.sh stop
    ;;
  restart)
    sh run.sh restart "${2:-}"
    ;;
  status)
    docker compose ps
    ;;
  logs)
    sh run.sh logs "${2:-}"
    ;;
  secrets)
    sh run.sh secrets
    ;;
  backup)
    "$SCRIPT_DIR/backup.sh"
    ;;
  url)
    if [[ -f "$SCRIPT_DIR/.env.generated" ]]; then
      cat "$SCRIPT_DIR/.env.generated"
    else
      POSTGRES_PASSWORD="$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)"
      POOLER_TENANT_ID="$(grep '^POOLER_TENANT_ID=' .env | cut -d= -f2-)"
      echo "DATABASE_URL=postgresql://postgres.${POOLER_TENANT_ID}:${POSTGRES_PASSWORD}@127.0.0.1:6543/postgres"
    fi
    ;;
  *)
    echo "Uso: $0 {start|stop|restart|status|logs|secrets|backup|url}"
    exit 1
    ;;
esac
