#!/usr/bin/env bash
# Pull latest main from GitHub and restart the dev server on AWS.
# Usage: ./deploy.sh
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Fetching latest main"
git fetch origin main
git checkout main
git pull origin main

echo "==> Installing dependencies"
npm install

echo "==> Restarting server"
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart ct-pp --update-env || pm2 start "npm run dev -- --host 0.0.0.0 --port 5173 --strictPort" --name ct-pp
  pm2 save
else
  echo "pm2 not found, killing any existing dev server on port 5173 and starting a new one with nohup"
  pkill -f "vite --host 0.0.0.0 --port 5173" || true
  nohup npm run dev -- --host 0.0.0.0 --port 5173 --strictPort > server.log 2>&1 &
  disown
fi

echo "==> Deploy complete"
