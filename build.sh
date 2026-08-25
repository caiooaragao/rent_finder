#!/usr/bin/env bash
# Build e deploy completo do Rent Finder.
# Uso:
#   ./build.sh              # deps + db + migrate + build
#   ./build.sh --start      # idem + next start em background (porta 5000)
#   ./build.sh --start --docker  # idem + front em container Docker
#   ./build.sh --dev        # deps + db + migrate + next dev em background
#   ./build.sh --stop       # para o servidor front em background
#   ./build.sh --status     # estado do servidor front
#   ./build.sh --skip-migrate    # sem aplicar migrações SQL
#   ./build.sh --scrape     # inclui scrape OLX após migrate
#   ./build.sh --foreground # com --start/--dev, bloqueia o terminal (comportamento antigo)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONT_DIR="$ROOT_DIR/rent_finder_front"
SCRAPER_DIR="$ROOT_DIR/rent_finder_scraper"
ENV_LOCAL="$FRONT_DIR/.env.local"
RUN_DIR="$ROOT_DIR/.run"
FRONT_PID_FILE="$RUN_DIR/front.pid"
FRONT_LOG_FILE="$RUN_DIR/front.log"
FRONT_PORT="${FRONT_PORT:-5000}"
FRONT_DOCKER_DIR="$ROOT_DIR/docker/front"
FRONT_CONTAINER_NAME="${FRONT_CONTAINER_NAME:-rent-finder-front}"
FRONT_IMAGE_NAME="${FRONT_IMAGE_NAME:-rent-finder-front}"

SKIP_INSTALL=false
SKIP_MIGRATE=false
DO_START=false
DO_DEV=false
DO_SCRAPE=false
DO_STOP=false
DO_STATUS=false
FOREGROUND=false
DO_DOCKER=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-install) SKIP_INSTALL=true; shift ;;
    --skip-migrate) SKIP_MIGRATE=true; shift ;;
    --start) DO_START=true; shift ;;
    --dev) DO_DEV=true; shift ;;
    --scrape) DO_SCRAPE=true; shift ;;
    --stop) DO_STOP=true; shift ;;
    --status) DO_STATUS=true; shift ;;
    --foreground) FOREGROUND=true; shift ;;
    --docker) DO_DOCKER=true; shift ;;
    -h | --help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
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

load_env_local() {
  set -a
  # shellcheck disable=SC1090
  source "$ENV_LOCAL"
  set +a
}

warn_local_database_url() {
  if [[ "${DATABASE_URL:-}" == *127.0.0.1* || "${DATABASE_URL:-}" == *localhost* ]]; then
    log "AVISO: DATABASE_URL aponta para localhost — em deploy use o Supabase Cloud."
  fi
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' não encontrado no PATH."
}

front_pid() {
  if [[ -f "$FRONT_PID_FILE" ]]; then
    cat "$FRONT_PID_FILE"
  fi
}

front_port_in_use() {
  if (echo >/dev/tcp/127.0.0.1/"$FRONT_PORT") 2>/dev/null; then
    return 0
  fi
  if (echo >/dev/tcp/::1/"$FRONT_PORT") 2>/dev/null; then
    return 0
  fi
  return 1
}

pids_listening_on_port() {
  local port="$1"
  local -a found=()
  local pid cid fuser_out

  if command -v fuser >/dev/null 2>&1; then
    fuser_out="$(fuser "${port}/tcp" 2>&1 || fuser -n tcp "$port" 2>&1 || true)"
    while IFS= read -r pid; do
      [[ -n "$pid" ]] && found+=("$pid")
    done < <(tr ' ' '\n' <<<"$fuser_out" | grep -E '^[0-9]+$' || true)
  fi

  if command -v lsof >/dev/null 2>&1; then
    while IFS= read -r pid; do
      [[ -n "$pid" ]] && found+=("$pid")
    done < <(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  fi

  if command -v ss >/dev/null 2>&1; then
    while IFS= read -r pid; do
      [[ -n "$pid" ]] && found+=("$pid")
    done < <(
      ss -ltnp 2>/dev/null \
        | grep -E ":${port}([^0-9]|$)" \
        | grep -oE 'pid=[0-9]+' \
        | cut -d= -f2 \
        | sort -u || true
    )
  fi

  if command -v netstat >/dev/null 2>&1; then
    while IFS= read -r pid; do
      [[ -n "$pid" ]] && found+=("$pid")
    done < <(
      netstat -tlnp 2>/dev/null \
        | grep -E ":${port}([^0-9]|$)" \
        | awk '{print $NF}' \
        | sed 's|/[^/]*$||' \
        | grep -E '^[0-9]+$' || true
    )
  fi

  if command -v docker >/dev/null 2>&1; then
    while IFS= read -r cid; do
      [[ -n "$cid" ]] || continue
      pid="$(docker inspect -f '{{.State.Pid}}' "$cid" 2>/dev/null || true)"
      [[ "$pid" =~ ^[0-9]+$ ]] && [[ "$pid" -gt 0 ]] && found+=("$pid")
    done < <(docker_container_ids_on_port "$port")
  fi

  if command -v pgrep >/dev/null 2>&1; then
    while IFS= read -r pid; do
      [[ -n "$pid" ]] && found+=("$pid")
    done < <(pgrep -f "next-server|next start -p ${port}" 2>/dev/null || true)
  fi

  printf '%s\n' "${found[@]}" | sort -u
}

docker_container_ids_on_port() {
  local port="$1"
  local cid ports

  while IFS= read -r cid; do
    [[ -n "$cid" ]] || continue
    ports="$(docker port "$cid" 2>/dev/null || true)"
    if grep -qE ":${port}([[:space:]]|$)" <<<"$ports"; then
      echo "$cid"
      continue
    fi
    if docker ps --format '{{.ID}} {{.Ports}}' --filter "id=$cid" 2>/dev/null \
      | grep -qE "[0-9.:]+:${port}->"; then
      echo "$cid"
    fi
  done < <(docker ps -q 2>/dev/null || true)
}

force_kill_port_listeners() {
  local port="$1"
  local pid

  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    log "A encerrar PID $pid na porta $port..."
    kill_pid_gracefully "$pid"
  done < <(pids_listening_on_port "$port")

  if command -v fuser >/dev/null 2>&1; then
    log "A forçar libertação da porta $port (fuser -k)..."
    fuser -k "${port}/tcp" 2>/dev/null || fuser -k -n tcp "$port" 2>/dev/null || true
    sleep 1
  fi
}

kill_pid_gracefully() {
  local pid="$1"
  [[ -n "$pid" ]] || return 0
  kill "$pid" 2>/dev/null || true

  for _ in $(seq 1 10); do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done

  kill -9 "$pid" 2>/dev/null || true
}

cleanup_front_docker() {
  command -v docker >/dev/null 2>&1 || return 0

  if [[ -f "$FRONT_DOCKER_DIR/docker-compose.yml" ]]; then
    log "A parar stack Docker do front (compose down)..."
    (
      cd "$FRONT_DOCKER_DIR"
      FRONT_PORT="$FRONT_PORT" \
      FRONT_CONTAINER_NAME="$FRONT_CONTAINER_NAME" \
      FRONT_IMAGE_NAME="$FRONT_IMAGE_NAME" \
        docker compose down --remove-orphans 2>/dev/null
    ) || true
  fi

  local name cid cname img_id
  local -a container_names=(
    "$FRONT_CONTAINER_NAME"
    rent-finder-front
    rent_finder_front
  )

  for name in "${container_names[@]}"; do
    if docker ps -a --format '{{.Names}}' | grep -Fxq "$name"; then
      log "A remover container Docker '$name'..."
      docker rm -f "$name" 2>/dev/null || true
    fi
  done

  while IFS= read -r cid; do
    [[ -n "$cid" ]] || continue
    cname="$(docker inspect -f '{{.Name}}' "$cid" 2>/dev/null | sed 's|^/||')"
    log "A remover container Docker na porta $FRONT_PORT (${cname:-$cid})..."
    docker rm -f "$cid" 2>/dev/null || true
  done < <(docker ps -aq --filter "publish=$FRONT_PORT" 2>/dev/null || true)

  while IFS= read -r cid; do
    [[ -n "$cid" ]] || continue
    cname="$(docker inspect -f '{{.Name}}' "$cid" 2>/dev/null | sed 's|^/||')"
    log "A remover container Docker mapeado para :$FRONT_PORT (${cname:-$cid})..."
    docker rm -f "$cid" 2>/dev/null || true
  done < <(docker_container_ids_on_port "$FRONT_PORT")

  while IFS= read -r img_id; do
    [[ -n "$img_id" ]] || continue
    log "A remover imagem Docker antiga ($img_id)..."
    docker rmi -f "$img_id" 2>/dev/null || true
  done < <(docker images "$FRONT_IMAGE_NAME" -q 2>/dev/null | sort -u || true)

  for img in "${FRONT_IMAGE_NAME}:latest" "rent-finder-front:latest"; do
    if docker image inspect "$img" >/dev/null 2>&1; then
      log "A remover imagem Docker '$img'..."
      docker rmi -f "$img" 2>/dev/null || true
    fi
  done
}

free_front_port() {
  local -a pids=()
  local pid attempt

  cleanup_front_docker

  if front_is_running; then
    log "A parar instância anterior do front (PID $(front_pid))..."
    kill_pid_gracefully "$(front_pid)"
    rm -f "$FRONT_PID_FILE"
  fi

  if ! front_port_in_use; then
    return 0
  fi

  for attempt in 1 2 3; do
    pids=()
    while IFS= read -r pid; do
      [[ -n "$pid" ]] && pids+=("$pid")
    done < <(pids_listening_on_port "$FRONT_PORT")

    if [[ ${#pids[@]} -gt 0 ]]; then
      log "Porta $FRONT_PORT em uso (PIDs: ${pids[*]}). A encerrar..."
      for pid in "${pids[@]}"; do
        kill_pid_gracefully "$pid"
      done
    else
      log "Porta $FRONT_PORT ocupada (tentativa $attempt/3); a procurar processo..."
      cleanup_front_docker
      force_kill_port_listeners "$FRONT_PORT"
    fi

    if ! front_port_in_use; then
      log "Porta $FRONT_PORT livre."
      return 0
    fi

    sleep 2
  done

  log "Diagnóstico da porta $FRONT_PORT:"
  ss -ltnp 2>/dev/null | grep -E ":$FRONT_PORT\b" || true
  docker ps --format 'table {{.Names}}\t{{.Ports}}' 2>/dev/null | grep -E "$FRONT_PORT|PORTS" || true
  die "Porta $FRONT_PORT continua ocupada. Execute: ./build.sh --stop  ou  fuser -k ${FRONT_PORT}/tcp"
}

front_is_running() {
  local pid
  pid="$(front_pid || true)"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

stop_front() {
  cleanup_front_docker

  if front_is_running; then
    log "A parar servidor front (PID $(front_pid))..."
    kill_pid_gracefully "$(front_pid)"
    rm -f "$FRONT_PID_FILE"
  fi

  if front_port_in_use; then
    free_front_port
  fi

  if front_is_running || front_port_in_use; then
    die "Não foi possível parar o servidor front na porta $FRONT_PORT."
  fi

  log "Servidor front parado."
}

status_front() {
  if command -v docker >/dev/null 2>&1; then
    if docker ps --format '{{.Names}}' | grep -Fxq "$FRONT_CONTAINER_NAME"; then
      printf 'Docker front: em execução (%s)\n' "$FRONT_CONTAINER_NAME"
      docker ps --filter "name=^/${FRONT_CONTAINER_NAME}$" \
        --format '  imagem: {{.Image}} | portas: {{.Ports}}' 2>/dev/null || true
    else
      printf 'Docker front: parado\n'
    fi
  fi

  if front_port_in_use; then
    printf 'Porta %s: em uso\n' "$FRONT_PORT"
  else
    printf 'Porta %s: livre\n' "$FRONT_PORT"
  fi

  if front_is_running; then
    printf 'Servidor front: em execução (PID %s)\n' "$(front_pid)"
    printf 'Logs: %s\n' "$FRONT_LOG_FILE"
    if [[ -f "$FRONT_LOG_FILE" ]]; then
      printf '\nÚltimas linhas do log:\n'
      tail -n 8 "$FRONT_LOG_FILE" 2>/dev/null || true
    fi
  else
    rm -f "$FRONT_PID_FILE"
    printf 'Servidor front: parado\n'
  fi
}

start_front_docker() {
  require_cmd docker
  docker compose version >/dev/null 2>&1 || die "'docker compose' não disponível."
  [[ -f "$FRONT_DOCKER_DIR/docker-compose.yml" ]] \
    || die "Ficheiro em falta: $FRONT_DOCKER_DIR/docker-compose.yml"
  [[ -f "$ENV_LOCAL" ]] || die "Ficheiro em falta: $ENV_LOCAL"

  mkdir -p "$RUN_DIR"
  free_front_port
  rm -f "$FRONT_PID_FILE"

  log "A construir imagem e iniciar front em Docker (porta $FRONT_PORT)..."
  load_env_local
  export DATABASE_URL
  (
    cd "$FRONT_DOCKER_DIR"
    FRONT_PORT="$FRONT_PORT" \
    FRONT_CONTAINER_NAME="$FRONT_CONTAINER_NAME" \
    FRONT_IMAGE_NAME="$FRONT_IMAGE_NAME" \
    DATABASE_URL="$DATABASE_URL" \
      docker compose up -d --build --force-recreate --remove-orphans
  )

  for _ in $(seq 1 60); do
    if front_port_in_use; then
      break
    fi
    sleep 2
  done

  if front_port_in_use; then
    log "Front Docker em execução."
    echo "  URL:       http://localhost:$FRONT_PORT"
    echo "  Container: $FRONT_CONTAINER_NAME"
    echo "  Imagem:    ${FRONT_IMAGE_NAME}:latest"
    echo "  Logs:      cd docker/front && docker compose logs -f front"
    echo "  Parar:     ./build.sh --stop"
  else
    die "Container Docker não abriu a porta $FRONT_PORT. Ver: cd docker/front && docker compose logs front"
  fi
}

start_front_background() {
  local mode="$1"

  mkdir -p "$RUN_DIR"
  free_front_port
  rm -f "$FRONT_PID_FILE"

  if [[ "$mode" == "dev" ]]; then
    log "A iniciar servidor de desenvolvimento em background (porta $FRONT_PORT)..."
  else
    log "A iniciar servidor de produção em background (porta $FRONT_PORT)..."
  fi

  : >"$FRONT_LOG_FILE"
  (
    cd "$FRONT_DIR"
    load_env_local
    if [[ "$mode" == "dev" ]]; then
      nohup npm run dev >>"$FRONT_LOG_FILE" 2>&1 &
    else
      nohup npm run start >>"$FRONT_LOG_FILE" 2>&1 &
    fi
    echo $! >"$FRONT_PID_FILE"
  )

  for _ in $(seq 1 30); do
    if grep -qE 'Ready|started server|Local:' "$FRONT_LOG_FILE" 2>/dev/null; then
      break
    fi
    if ! kill -0 "$(cat "$FRONT_PID_FILE")" 2>/dev/null; then
      break
    fi
    sleep 1
  done

  if front_is_running; then
    log "Servidor em background (PID $(front_pid))."
    echo "  URL:  http://localhost:$FRONT_PORT"
    echo "  Logs: $FRONT_LOG_FILE"
    echo "  Parar: ./build.sh --stop"
  else
    die "Servidor não iniciou. Ver $FRONT_LOG_FILE"
  fi
}

if [[ "$DO_STOP" == true ]]; then
  stop_front
  exit 0
fi

if [[ "$DO_STATUS" == true ]]; then
  status_front
  exit 0
fi

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

# --- DATABASE_URL ---
[[ -f "$ENV_LOCAL" ]] || die "Ficheiro em falta: $ENV_LOCAL — copie rent_finder_front/.env.example e defina DATABASE_URL (Supabase Cloud)."
grep -q '^DATABASE_URL=.\+' "$ENV_LOCAL" || die "DATABASE_URL vazio em $ENV_LOCAL"
load_env_local
warn_local_database_url
export DATABASE_URL

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
  if [[ "$DO_DOCKER" == true ]]; then
    die "Modo --docker só está disponível com --start (produção)."
  fi
  if [[ "$FOREGROUND" == true ]]; then
    free_front_port
    log "A iniciar servidor de desenvolvimento (porta $FRONT_PORT)..."
    cd "$FRONT_DIR"
    load_env_local
    exec npm run dev
  fi
  start_front_background dev
  exit 0
fi

if [[ "$DO_START" == true && "$DO_DOCKER" == true ]]; then
  start_front_docker
  exit 0
fi

log "A fazer build de produção (Next.js)..."
npm run build

if [[ "$DO_START" == true ]]; then
  if [[ "$FOREGROUND" == true ]]; then
    free_front_port
    log "A iniciar servidor de produção (porta $FRONT_PORT)..."
    cd "$FRONT_DIR"
    load_env_local
    exec npm run start
  fi
  start_front_background start
  exit 0
fi

log "Build concluído."
echo ""
echo "  DATABASE_URL: configurado em rent_finder_front/.env.local"
echo "  Produção:     ./build.sh --start"
echo "  Docker:       ./build.sh --start --docker"
echo "  Dev:          ./build.sh --dev"
echo "  Parar front:  ./build.sh --stop"
echo "  Estado:       ./build.sh --status"
echo "  Scrape:       ./build.sh --scrape"
echo ""
