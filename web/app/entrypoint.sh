#!/bin/sh
set -eu

ENV_CONFIG_PATH="/usr/share/nginx/html/env-config.js"

cat >"$ENV_CONFIG_PATH" <<EOF
window.__APP_ENV__ = {
  VITE_SERVER_URL: "${VITE_SERVER_URL:-}",
  VITE_ENV: "${VITE_ENV:-production}",
  VITE_IS_DOCKER: "${VITE_IS_DOCKER:-false}",
  VITE_POSTHOG_KEY: "${VITE_POSTHOG_KEY:-}",
  VITE_POSTHOG_HOST: "${VITE_POSTHOG_HOST:-}",
};
EOF

echo "Wrote runtime env config to ${ENV_CONFIG_PATH}"

exec "$@"
