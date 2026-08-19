#!/usr/bin/env bash
# Cloudflare quick tunnel — free, no Cloudflare account needed.
#
# Boots the local server if it isn't running, then opens a public
# https://<random>.trycloudflare.com URL pointing at it. Press Ctrl+C to stop.
#
# Usage:  scripts/tunnel.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is not installed. Install it with one of:" >&2
  echo "  npm install -g cloudflared" >&2
  echo "  brew install cloudflared" >&2
  echo "  sudo apt install cloudflared        # Debian/Ubuntu" >&2
  echo "  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" >&2
  exit 1
fi

# Boot the server on :3001 if nothing is answering there yet.
if ! curl -sf -o /dev/null http://localhost:3001/ 2>/dev/null; then
  echo "Starting server on :3001 ..."
  mkdir -p server/data
  (cd server && nohup env PORT=3001 npm start > ../server.log 2>&1 &)
  for _ in $(seq 1 20); do
    curl -sf -o /dev/null http://localhost:3001/ 2>/dev/null && break
    sleep 1
  done
  if ! curl -sf -o /dev/null http://localhost:3001/ 2>/dev/null; then
    echo "Server did not come up — check server.log" >&2
    exit 1
  fi
fi

echo "Opening Cloudflare tunnel to http://localhost:3001 ..."
echo "The public URL is printed below (https://<random>.trycloudflare.com)."
cloudflared tunnel --url http://localhost:3001