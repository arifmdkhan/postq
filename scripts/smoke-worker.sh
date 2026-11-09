#!/usr/bin/env bash
set -euo pipefail
pnpm exec wrangler d1 migrations apply DB --local
worker_log="$(mktemp)"
pnpm exec wrangler dev --local --ip 127.0.0.1 --port 8787 \
  --var BETTER_AUTH_SECRET:ci-only-secret-2026-no-production-use \
  --var BETTER_AUTH_URL:http://127.0.0.1:8787 \
  --var POSTQ_PUBLISHING_PAUSED:yes >"$worker_log" 2>&1 &
worker_pid=$!
trap 'kill "$worker_pid" 2>/dev/null || true' EXIT
ready=false
for ((attempt=0;attempt<60;attempt++)); do
  if curl --fail --silent --max-time 3 http://127.0.0.1:8787/login >/dev/null; then ready=true; break; fi
  if ! kill -0 "$worker_pid" 2>/dev/null; then cat "$worker_log"; exit 1; fi
  sleep 1
done
if [ "$ready" != true ]; then cat "$worker_log"; exit 1; fi
POSTQ_SMOKE_URL=http://127.0.0.1:8787 node scripts/smoke.mjs
curl --fail --silent --max-time 30 http://127.0.0.1:8787/cdn-cgi/local/scheduled
