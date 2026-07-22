#!/bin/zsh
# Share Chonky Cheesus on the public internet (laptop must stay awake).
# Usage:  ./start-public.sh

set -e
cd "$(dirname "$0")"

PORT="${PORT:-8787}"

if ! curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  echo "Starting cult server on port ${PORT}..."
  python3 server.py &
  SERVER_PID=$!
  sleep 1
  if ! curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    echo "Server failed to start. Is the port free?"
    exit 1
  fi
  echo "Server PID: ${SERVER_PID}"
else
  echo "Cult server already running on :${PORT}"
fi

echo ""
echo "Opening public tunnel... (leave this window open)"
echo "Share the https://....trycloudflare.com URL that appears below."
echo "Ctrl+C stops the tunnel (server may keep running)."
echo ""

exec cloudflared tunnel --url "http://127.0.0.1:${PORT}"
