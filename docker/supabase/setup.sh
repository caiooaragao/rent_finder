#!/usr/bin/env bash
# Instala Supabase self-hosted (oficial) com dados persistentes.
# Uso: ./setup.sh [--dir /opt/rent-finder/supabase] [--yes]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_REF="${SUPABASE_REF:-self-hosted/v0.8.0}"
INSTALL_DIR="${INSTALL_DIR:-$SCRIPT_DIR/project}"
AUTO_YES=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes | -y)
      AUTO_YES=true
      shift
      ;;
    --dir)
      INSTALL_DIR="${2:?--dir requer um caminho}"
      shift 2
      ;;
    --dir=*)
      INSTALL_DIR="${1#*=}"
      shift
      ;;
    *)
      echo "Argumento desconhecido: $1"
      exit 1
      ;;
  esac
done

echo "==> Rent Finder — setup Supabase self-hosted"
echo "    versão: $SUPABASE_REF"
echo "    destino: $INSTALL_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Erro: Docker não encontrado. Instale Docker Engine + Compose plugin."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Erro: 'docker compose' não disponível."
  exit 1
fi

mkdir -p "$INSTALL_DIR"

if [[ ! -f "$INSTALL_DIR/docker-compose.yml" ]]; then
  echo "==> A obter configuração oficial do Supabase..."
  TMP_CLONE="$(mktemp -d)"
  trap 'rm -rf "$TMP_CLONE"' EXIT

  git clone --depth 1 --branch "$SUPABASE_REF" \
    https://github.com/supabase/supabase "$TMP_CLONE/supabase"

  cp -rf "$TMP_CLONE/supabase/docker/." "$INSTALL_DIR/"
  printf 'ref=%s\n' "$SUPABASE_REF" > "$INSTALL_DIR/.supabase-version"
else
  echo "==> Já existe instalação em $INSTALL_DIR — a saltar cópia dos ficheiros."
fi

cd "$INSTALL_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

if ! grep -q '^POSTGRES_PASSWORD=.\+' .env 2>/dev/null || grep -q 'your-super-secret' .env 2>/dev/null; then
  echo "==> A gerar segredos..."
  sh utils/generate-keys.sh
  sh utils/add-new-auth-keys.sh
fi

# Tenant fixo para connection strings previsíveis no Rent Finder
if grep -q '^POOLER_TENANT_ID=' .env; then
  sed -i.bak 's/^POOLER_TENANT_ID=.*/POOLER_TENANT_ID=rentfinder/' .env
else
  echo 'POOLER_TENANT_ID=rentfinder' >> .env
fi
rm -f .env.bak

# URLs locais (ajuste SUPABASE_PUBLIC_URL se expuser via domínio)
for var in SUPABASE_PUBLIC_URL API_EXTERNAL_URL SITE_URL; do
  if grep -q "^${var}=" .env; then
    sed -i.bak "s|^${var}=.*|${var}=http://127.0.0.1:8000|" .env
  fi
done
rm -f .env.bak

# Persistência: dados em ./volumes/ (bind mount) sobrevivem a restart/reboot.
# Nunca execute reset.sh em produção — isso apaga volumes/db/data.
mkdir -p volumes/db/data volumes/storage

echo "==> A aplicar override de persistência..."
cp -f "$SCRIPT_DIR/docker-compose.override.yml" "$INSTALL_DIR/docker-compose.override.yml"

echo "==> A puxar imagens Docker..."
docker compose pull

echo "==> A iniciar stack..."
sh run.sh start

POSTGRES_PASSWORD="$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)"
POOLER_TENANT_ID="$(grep '^POOLER_TENANT_ID=' .env | cut -d= -f2-)"

DATABASE_URL="postgresql://postgres.${POOLER_TENANT_ID}:${POSTGRES_PASSWORD}@127.0.0.1:6543/postgres"

cat > "$SCRIPT_DIR/.env.generated" <<EOF
# Gerado por docker/supabase/setup.sh — copie para rent_finder_front/.env.local
DATABASE_URL="${DATABASE_URL}"
EOF

echo ""
echo "=============================================="
echo " Supabase self-hosted pronto."
echo " Studio:  http://127.0.0.1:8000"
echo " Dados:   $INSTALL_DIR/volumes/db/data"
echo ""
echo " DATABASE_URL (transaction pooler, porta 6543):"
echo " $DATABASE_URL"
echo ""
echo " Guarde a password em local seguro:"
echo " POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
echo ""
echo " Próximos passos no monorepo:"
echo "   1. cp docker/supabase/.env.generated rent_finder_front/.env.local"
echo "   2. npm run db:migrate"
echo "   3. npm run dev   (ou deploy da app no mesmo servidor)"
echo "=============================================="
