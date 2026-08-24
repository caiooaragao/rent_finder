#!/usr/bin/env bash
# Build e deploy completo do Rent Finder.
# Uso:
#   ./build.sh              # deps + db + migrate + build
#   ./build.sh --start      # idem + next start (produção)
#   ./build.sh --dev        # deps + db + migrate + next dev
#   ./build.sh --skip-db    # sem tocar no Supabase (já a correr)
#   ./build.sh --scrape     # inclui scrape OLX após migrate
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONT_DIR="$ROOT_DIR/rent_finder_front"
SCRAPER_DIR="$ROOT_DIR/rent_finder_scraper"
SUPABASE_DIR="$ROOT_DIR/docker/supabase"
ENV_LOCAL="$FRONT_DIR/.env.local"
ENV_GENERATED="$SUPABASE_DIR/.env.generated"

SKIP_DB=false
SKIP_INSTALL=false
SKIP_MIGRATE=false
DO_START=false
DO_DEV=false
DO_SCRAPE=false
SUPABASE_INSTALL_DIR="${SUPABASE_INSTALL_DIR:-$SUPABASE_DIR/project}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-db) SKIP_DB=true; shift ;;
    --skip-install) SKIP_INSTALL=true; shift ;;
    --skip-migrate) SKIP_MIGRATE=true; shift ;;
    --start) DO_START=true; shift ;;
    --dev) DO_DEV=true; shift ;;
    --scrape) DO_SCRAPE=true; shift ;;
    -h | --help)
      sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Argumento desconhecido: $1 (use --help)"
      exit 1
      ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'Erro: %s\n' "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' não encontrado no PATH."
}

require_cmd node
require_cmd npm

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
[[ "$NODE_MAJOR" -ge 20 ]] || die "Node.js >= 20.9 necessário (atual: $(node -v))."

cd "$ROOT_DIR"

# --- Dependências ---
if [[ "$SKIP_INSTALL" == false ]]; then
  log "A instalar dependências (front + scraper)..."
  npm ci --prefix "$FRONT_DIR" 2>/dev/null || npm install --prefix "$FRONT_DIR"
  npm ci --prefix "$SCRAPER_DIR" 2>/dev/null || npm install --prefix "$SCRAPER_DIR"
fi

# --- Supabase Docker ---
if [[ "$SKIP_DB" == false ]]; then
  require_cmd docker
  docker compose version >/dev/null 2>&1 || die "'docker compose' não disponível."

  if [[ ! -f "$SUPABASE_INSTALL_DIR/docker-compose.yml" ]]; then
    log "Supabase não instalado — a executar setup..."
    chmod +x "$SUPABASE_DIR/setup.sh" "$SUPABASE_DIR/manage.sh" 2>/dev/null || true
    SUPABASE_INSTALL_DIR="$SUPABASE_INSTALL_DIR" bash "$SUPABASE_DIR/setup.sh"
  else
    log "A iniciar Supabase..."
    SUPABASE_INSTALL_DIR="$SUPABASE_INSTALL_DIR" bash "$SUPABASE_DIR/manage.sh" start
  fi

  # Aguardar pooler (6543)
  log "A aguardar Postgres (porta 6543)..."
  for _ in $(seq 1 60); do
    if (echo >/dev/tcp/127.0.0.1/6543) 2>/dev/null; then
      break
    fi
    sleep 2
  done
  (echo >/dev/tcp/127.0.0.1/6543) 2>/dev/null || die "Postgres não respondeu na porta 6543."
fi

# --- DATABASE_URL ---
if [[ -f "$ENV_GENERATED" ]]; then
  if [[ ! -f "$ENV_LOCAL" ]]; then
    log "A copiar DATABASE_URL para rent_finder_front/.env.local"
    cp "$ENV_GENERATED" "$ENV_LOCAL"
  fi
elif [[ ! -f "$ENV_LOCAL" ]]; then
  die "DATABASE_URL em falta. Defina rent_finder_front/.env.local ou execute sem --skip-db."
fi

[[ -f "$ENV_LOCAL" ]] || die "Ficheiro em falta: $ENV_LOCAL"
grep -q '^DATABASE_URL=.\+' "$ENV_LOCAL" || die "DATABASE_URL vazio em $ENV_LOCAL"

# --- Migrações ---
if [[ "$SKIP_MIGRATE" == false ]]; then
  log "A aplicar migrações SQL..."
  npm run db:migrate
fi

# --- Scrape (opcional) ---
if [[ "$DO_SCRAPE" == true ]]; then
  log "A executar scrape OLX (pode demorar)..."
  npm run scrape
fi

# --- Build ou Dev ---
if [[ "$DO_DEV" == true ]]; then
  log "A iniciar servidor de desenvolvimento (porta 5000)..."
  exec npm run dev
fi

log "A fazer build de produção (Next.js)..."
npm run build

if [[ "$DO_START" == true ]]; then
  log "A iniciar servidor de produção (porta 5000)..."
  exec npm run start --prefix "$FRONT_DIR"
fi

log "Build concluído."
echo ""
echo "  DATABASE_URL: configurado em rent_finder_front/.env.local"
echo "  Produção:     ./build.sh --start"
echo "  Dev:          ./build.sh --dev"
echo "  Scrape:       ./build.sh --scrape"
echo ""
