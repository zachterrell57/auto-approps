#!/usr/bin/env bash
set -euo pipefail

FRONTEND_PORT="${1:?Usage: start-frontend.sh <frontend-port> <backend-port>}"
BACKEND_PORT="${2:?Usage: start-frontend.sh <frontend-port> <backend-port>}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$SCRIPT_DIR/../frontend"
export BACKEND_PORT
exec npx vite --host 127.0.0.1 --port "$FRONTEND_PORT" --strictPort
