#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Find two available ports using Python socket probing
read -r BACKEND_PORT FRONTEND_PORT < <(python3 -c "
import socket

def find_free_port(start, exclude=set()):
    for port in range(start, start + 100):
        if port in exclude:
            continue
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.bind(('127.0.0.1', port))
            s.close()
            return port
        except OSError:
            continue
    raise RuntimeError(f'No free port found starting from {start}')

bp = find_free_port(8000)
fp = find_free_port(5173, exclude={bp})
print(bp, fp)
")

mkdir -p "$PROJECT_ROOT/.claude"

cat > "$PROJECT_ROOT/.claude/launch.json" << EOF
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "backend",
      "runtimeExecutable": "bash",
      "runtimeArgs": ["scripts/start-backend.sh", "$BACKEND_PORT"],
      "port": $BACKEND_PORT
    },
    {
      "name": "frontend",
      "runtimeExecutable": "bash",
      "runtimeArgs": ["scripts/start-frontend.sh", "$FRONTEND_PORT", "$BACKEND_PORT"],
      "port": $FRONTEND_PORT
    }
  ]
}
EOF

echo "Backend port:  $BACKEND_PORT"
echo "Frontend port: $FRONTEND_PORT"
echo "Generated .claude/launch.json"
