#!/usr/bin/env bash
# Prepara un database dimostrativo nuovo, compila l'interfaccia e avvia il server per la verifica e2e.
set -e
cd "$(dirname "$0")/.."
export HANDLAB_DB="${HANDLAB_DB:-/tmp/handlab-e2e.sqlite}"
[ -f /tmp/handlab-e2e.pid ] && kill "$(cat /tmp/handlab-e2e.pid)" 2>/dev/null || true
pkill -f "tsx.*src/index[.]ts" 2>/dev/null || true
sleep 1
npm run seed -- --reset >/dev/null
npm run build >/dev/null 2>&1
nohup npm start > /tmp/handlab-e2e-server.log 2>&1 &
echo $! > /tmp/handlab-e2e.pid
for i in $(seq 1 30); do curl -sf http://localhost:${PORT:-8787}/api/health >/dev/null && exit 0; sleep 1; done
echo "server non avviato"; exit 1
