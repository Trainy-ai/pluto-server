#!/bin/bash
set -euo pipefail

# Spin up a frontend+backend pair from any worktree.
# Auto-finds available port pairs starting at 4000/4001.
# Generated files are stored in .agent/ inside the worktree (gitignored).
#
# Usage:
#   ./scripts/dev.sh          # auto-pick ports
#   ./scripts/dev.sh 5000     # explicit frontend port (backend = port+1)
#
# After starting (replace 4000 with your assigned port):
#   Rebuild all:      docker compose -f .agent/compose.yml -p agent-4000 up --build -d
#   Frontend only:    docker compose -f .agent/compose.yml -p agent-4000 up --build -d frontend-4000
#   Backend only:     docker compose -f .agent/compose.yml -p agent-4000 up --build -d backend-4000
#   Logs:             docker compose -f .agent/compose.yml -p agent-4000 logs -f
#   Stop:             docker compose -f .agent/compose.yml -p agent-4000 down
#   List all stacks:  docker compose ls

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SCRIPT_DIR"

# Verify shared network exists
if ! docker network inspect mlop_network &>/dev/null; then
  echo "ERROR: mlop_network does not exist."
  echo "Start the main stack first:  cd ~/server-private && docker compose --env-file .env up -d"
  exit 1
fi

# Find available port pair (frontend, frontend+1)
find_available_port() {
  local port=$1
  while true; do
    local backend_port=$((port + 1))
    if ss -tln | awk -v p1="$port" -v p2="$backend_port" 'NR>1 {addr=$4; sub(/.*:/, "", addr)} addr==p1 || addr==p2 {exit 1}'; then
      echo "$port"
      return
    fi
    port=$((port + 1000))
    if [ "$port" -gt 9000 ]; then
      echo "ERROR: No available port pairs found (tried 4000-9000)" >&2
      exit 1
    fi
  done
}

if [ "${1:-}" != "" ]; then
  if [[ ! "$1" =~ ^[0-9]+$ ]]; then
    echo "ERROR: Port must be a number" >&2
    exit 1
  fi
  FRONTEND_PORT="$1"
else
  FRONTEND_PORT=$(find_available_port 4000)
fi
BACKEND_PORT=$((FRONTEND_PORT + 1))

PROJECT_NAME="agent-${FRONTEND_PORT}"

# Store generated files in .agent/ inside the worktree
AGENT_DIR="${SCRIPT_DIR}/.agent"
mkdir -p "$AGENT_DIR"

# Gitignore the .agent directory
if [ ! -f "${AGENT_DIR}/.gitignore" ]; then
  echo "*" > "${AGENT_DIR}/.gitignore"
fi

echo "Ports:   frontend=$FRONTEND_PORT  backend=$BACKEND_PORT"
echo "Project: $PROJECT_NAME"
echo "Source:  $SCRIPT_DIR"
echo ""

# Generate compose file
COMPOSE_FILE="${AGENT_DIR}/compose.yml"
NGINX_CONF="${AGENT_DIR}/nginx.conf"

cat > "$COMPOSE_FILE" <<YAML
services:
  backend-${FRONTEND_PORT}:
    build:
      context: ${REPO_ROOT}/web
      dockerfile: server/Dockerfile
    ports:
      - "${BACKEND_PORT}:${BACKEND_PORT}"
    networks:
      - mlop_network
    entrypoint: [ "/bin/sh", "-c", "prisma migrate deploy && node server/server.js" ]
    restart: unless-stopped
    environment:
      - MALLOC_ARENA_MAX=4
      - PORT=${BACKEND_PORT}
      - IS_DOCKER=true
      - PUBLIC_URL=http://localhost:${BACKEND_PORT}
      - BETTER_AUTH_URL=http://localhost:${FRONTEND_PORT}
      - BETTER_AUTH_SECRET=DONTUSETHISACTUALLYINPRODFORDEVTESTINGONLY
      - DATABASE_URL=postgresql://postgres:nope@db:5432/postgres
      - DATABASE_DIRECT_URL=postgresql://postgres:nope@db:5432/postgres
      - CLICKHOUSE_URL=http://clickhouse:8123
      - CLICKHOUSE_USER=nope
      - CLICKHOUSE_PASSWORD=nope
      - REDIS_URL=redis://redis:6379
      - STORAGE_ACCESS_KEY_ID=nope
      - STORAGE_SECRET_ACCESS_KEY=minioadmin
      - STORAGE_ENDPOINT=http://minio:9000
      - STORAGE_BUCKET=nope
      - STORAGE_REGION=auto
      - GITHUB_CLIENT_ID=nope
      - GITHUB_CLIENT_SECRET=nope
      - GOOGLE_CLIENT_ID=nope
      - GOOGLE_CLIENT_SECRET=nope

  frontend-${FRONTEND_PORT}:
    build:
      context: ${REPO_ROOT}/web/app
      dockerfile: Dockerfile
    ports:
      - "${FRONTEND_PORT}:${FRONTEND_PORT}"
    networks:
      - mlop_network
    depends_on:
      - backend-${FRONTEND_PORT}
    environment:
      - VITE_IS_DOCKER=true
      - VITE_SERVER_URL=http://localhost:${BACKEND_PORT}
    volumes:
      - ${NGINX_CONF}:/etc/nginx/conf.d/default.conf:ro

networks:
  mlop_network:
    external: true
YAML

# Generate nginx config pointing to the right backend
cat > "$NGINX_CONF" <<NGINX
server {
    listen       ${FRONTEND_PORT};
    server_name  localhost;
    root   /usr/share/nginx/html;
    index  index.html;

    location /trpc {
        proxy_pass http://backend-${FRONTEND_PORT}:${BACKEND_PORT}/trpc;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_http_version 1.1;
        proxy_buffering off;
    }

    location ~ ^/api/ {
        proxy_pass http://backend-${FRONTEND_PORT}:${BACKEND_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_http_version 1.1;
        proxy_buffering off;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX

echo "Building and starting..."
docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" up --build -d

echo ""
echo "====================================="
echo "  Frontend: http://localhost:${FRONTEND_PORT}"
echo "  Backend:  http://localhost:${BACKEND_PORT}"
echo "====================================="
echo ""
echo "Rebuild:  docker compose -f .agent/compose.yml -p $PROJECT_NAME up --build -d"
echo "Frontend: docker compose -f .agent/compose.yml -p $PROJECT_NAME up --build -d frontend-${FRONTEND_PORT}"
echo "Backend:  docker compose -f .agent/compose.yml -p $PROJECT_NAME up --build -d backend-${FRONTEND_PORT}"
echo "Logs:     docker compose -f .agent/compose.yml -p $PROJECT_NAME logs -f"
echo "Stop:     docker compose -f .agent/compose.yml -p $PROJECT_NAME down"
