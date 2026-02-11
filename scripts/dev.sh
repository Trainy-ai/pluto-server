#!/usr/bin/env bash
set -euo pipefail

# Multi-port dev runner
# Usage: ./scripts/dev.sh [--offset N] [--env ENV] <service>
#
# Services: app, server, ingest, py
#
# Examples:
#   ./scripts/dev.sh app                  # default ports (3000/3001/3003/3004)
#   ./scripts/dev.sh --offset 10 app      # offset ports (3010/3011/3013/3014)
#   ./scripts/dev.sh --offset 10 server
#   ./scripts/dev.sh --offset 10 ingest
#   ./scripts/dev.sh --offset 10 py
#
# Port mapping (default → offset 10):
#   app:    3000 → 3010
#   server: 3001 → 3011
#   ingest: 3003 → 3013
#   py:     3004 → 3014

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OFFSET=0
ENV_NAME="local"
SERVICE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --offset|-o)
      OFFSET="$2"
      shift 2
      ;;
    --env|-e)
      ENV_NAME="$2"
      shift 2
      ;;
    -*)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
    *)
      SERVICE="$1"
      shift
      ;;
  esac
done

if [[ -z "$SERVICE" ]]; then
  echo "Usage: $0 [--offset N] [--env ENV] <app|server|ingest|py>" >&2
  exit 1
fi

APP_PORT=$((3000 + OFFSET))
SERVER_PORT=$((3001 + OFFSET))
INGEST_PORT=$((3003 + OFFSET))
PY_PORT=$((3004 + OFFSET))

if [[ "$OFFSET" -ne 0 ]]; then
  echo "Port mapping (offset $OFFSET):"
  echo "  app:    $APP_PORT"
  echo "  server: $SERVER_PORT"
  echo "  ingest: $INGEST_PORT"
  echo "  py:     $PY_PORT"
  echo ""
fi

case "$SERVICE" in
  app)
    # Vite reads PORT_OFFSET and computes port + proxy target automatically
    # VITE_SERVER_URL is set explicitly so the frontend env.ts also picks it up
    APP_ENV_FILE="$ROOT/web/app/.env.${ENV_NAME}"
    if [[ ! -f "$APP_ENV_FILE" ]]; then
      echo "Error: $APP_ENV_FILE not found" >&2
      exit 1
    fi
    cd "$ROOT/web"
    export PORT_OFFSET="$OFFSET"
    export VITE_SERVER_URL="http://localhost:$SERVER_PORT"
    exec pnpm dotenv -e "app/.env.${ENV_NAME}" -- pnpm vite --port "$APP_PORT"
    ;;

  server)
    # For the server env, "local" maps to ".env.locals", others map to ".env.<name>"
    if [[ "$ENV_NAME" == "local" ]]; then
      SERVER_ENV_FILE="$ROOT/web/server/.env.locals"
    else
      SERVER_ENV_FILE="$ROOT/web/server/.env.${ENV_NAME}"
    fi
    if [[ ! -f "$SERVER_ENV_FILE" ]]; then
      echo "Error: $SERVER_ENV_FILE not found" >&2
      exit 1
    fi
    cd "$ROOT/web"
    # Generate Prisma client first
    pnpm dotenv -e "$SERVER_ENV_FILE" prisma generate --schema=server/prisma/schema.prisma
    # Override URL env vars with offset ports
    export PUBLIC_URL="http://localhost:$APP_PORT"
    export BETTER_AUTH_URL="http://localhost:$SERVER_PORT"
    exec pnpm dotenv -e "$SERVER_ENV_FILE" -- pnpm next dev --dir server -p "$SERVER_PORT"
    ;;

  ingest)
    cd "$ROOT/ingest"
    export PORT_OFFSET="$OFFSET"
    exec cargo run -- --env "$ENV_NAME"
    ;;

  py)
    cd "$ROOT/py"
    export PORT_OFFSET="$OFFSET"
    exec python server.py
    ;;

  *)
    echo "Unknown service: $SERVICE" >&2
    echo "Available: app, server, ingest, py" >&2
    exit 1
    ;;
esac
