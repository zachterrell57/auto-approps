#!/usr/bin/env bash
set -euo pipefail

PORT="${1:?Usage: start-backend.sh <port>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$SCRIPT_DIR/../backend"
export PYTHONPATH="$PWD/src${PYTHONPATH:+:$PYTHONPATH}"
exec python3 -m uvicorn auto_approps.app:app --host 0.0.0.0 --port "$PORT" --reload
