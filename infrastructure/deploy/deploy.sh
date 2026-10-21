#!/bin/sh
# Aglotrends auto-deploy — runs on the LIVE server (aaPanel webhook on a push to
# main, and/or a 2-minute cron poll). Idempotent: no new commit → health check
# only, no rebuild. Triggered unattended, so it must be fully non-interactive
# and fail LOUDLY: any failed step aborts before the next one runs, and a failed
# health check rolls back to the previous commit.
#
# One-time server setup: see infrastructure/deploy/DEPLOY-AA-PANEL.md
# Secrets live ONLY in apps/api/.env on the server — never in this file.
#
# Design notes:
# - Always deploys origin/main HEAD, whatever branch was pushed (a feature-branch
#   push triggers a harmless no-op redeploy, never a wrong deploy).
# - Migrations run automatically (drizzle-kit migrate is additive-only in this
#   project: 0000-0008 add tables/columns, never drop or alter data), and the
#   migration ledger is verified before the build (see below).
# - Rollback = previous commit + rebuild + restart. The DB is NOT rolled back
#   (migrations are forward-only by design).

set -eu

# ── Configure these for the server ──────────────────────
APP_DIR="/www/wwwroot/aglotrends.com"   # server checkout of the Aglotrends repo
BRANCH="main"
API_PORT="4001"
WEB_PORT="3200"                     # 3000 belongs to another app on this host
API_HEALTH="http://127.0.0.1:${API_PORT}/health"
WEB_HEALTH="http://127.0.0.1:${WEB_PORT}/"
# Absolute node/pnpm first: webhook/cron shells carry a minimal PATH.
export PATH="/www/server/nodejs/v24.18.0/bin:$PATH"
# ─────────────────────────────────────────────────────────

log() { echo "[deploy $(date '+%Y-%m-%dT%H:%M:%S')] $1"; }
fail() { log "FAILED: $1"; exit 1; }

# ── Run lock ─────────────────────────────────────────────
# The cron poll fires every 2 minutes; a full build takes longer than that.
# Without a lock, two runs race: one rebuilds while the other resets the tree
# mid-build, and the server ends up serving a half-written bundle. `mkdir` is
# atomic on POSIX, so it is a reliable lock; a stale lock (holder killed
# mid-deploy) is detected by PID and cleared.
LOCK_DIR="/tmp/aglotrends-deploy.lock"

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo $$ > "$LOCK_DIR/pid"
    return 0
  fi
  if [ -f "$LOCK_DIR/pid" ]; then
    holder="$(cat "$LOCK_DIR/pid" 2>/dev/null || echo "")"
    if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then
      log "another deploy is already running (pid $holder) — skipping this run"
      return 1
    fi
    log "clearing stale lock from pid ${holder:-unknown}"
    rm -rf "$LOCK_DIR"
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      echo $$ > "$LOCK_DIR/pid"
      return 0
    fi
  fi
  log "another deploy is already running — skipping this run"
  return 1
}

release_lock() { rm -rf "$LOCK_DIR"; }

acquire_lock || exit 0
trap 'release_lock' EXIT INT TERM

# (Re)start both processes with a FRESH environment. Never `pm2 restart`:
# it preserves the old env, so a changed .env would silently not apply.
start_processes() {
  pm2 delete aglotrends-api aglotrends-web >/dev/null 2>&1 || true
  (cd "$APP_DIR/apps/api" && pm2 start dist/index.js --name aglotrends-api) || return 1
  (cd "$APP_DIR/apps/web" && pm2 start node_modules/next/dist/bin/next --name aglotrends-web -- start -p "$WEB_PORT") || return 1
  pm2 save >/dev/null 2>&1 || true
}

[ -d "$APP_DIR/.git" ] || fail "APP_DIR $APP_DIR is not a git checkout"
cd "$APP_DIR"

# The webhook runs with a minimal PATH — fail here naming the missing binary,
# not halfway through a deploy. If these exist interactively but not here,
# export an absolute PATH above (e.g. /root/.nvm/versions/...).
for bin in git pnpm curl node pm2; do
  command -v "$bin" >/dev/null 2>&1 || fail "required binary not on webhook PATH: $bin"
done

PREV_COMMIT="$(git rev-parse HEAD)"
log "previous commit: $PREV_COMMIT"

log "fetching origin/$BRANCH…"
git fetch --prune origin || fail "git fetch failed (network or remote down)"

log "resetting to origin/$BRANCH…"
git reset --hard "origin/$BRANCH" || fail "git reset failed"

NEW_COMMIT="$(git rev-parse HEAD)"

# The commit that was last BUILT and deployed successfully. `deploy.log` is
# appended to only after a healthy deploy, so it is the ground truth for
# "what is actually running" — NOT `git rev-parse HEAD`.
#
# Why this exists: the cron wrapper used to `git reset --hard origin/main`
# BEFORE calling this script, which made the "commit changed?" check below
# always false, so the build was silently skipped and the server kept serving
# a stale bundle. Comparing against the last DEPLOYED commit is immune to
# that: if the tree says X but we last deployed Y, we rebuild.
LAST_DEPLOYED=""
if [ -f deploy.log ]; then
  LAST_DEPLOYED="$(sed -n 's/^\([0-9a-f]\{40\}\).*/\1/p' deploy.log 2>/dev/null | tail -n 1 || true)"
fi
log "last deployed commit: ${LAST_DEPLOYED:-none}"

if [ "$NEW_COMMIT" = "$PREV_COMMIT" ] && [ "$NEW_COMMIT" = "$LAST_DEPLOYED" ]; then
  log "already on $NEW_COMMIT and already built — verifying health only, no rebuild"
  if curl -sf -m 5 "$API_HEALTH" >/dev/null 2>&1 && curl -sf -m 5 "$WEB_HEALTH" >/dev/null 2>&1; then
    log "HEALTHY on $NEW_COMMIT — nothing to do"
    exit 0
  fi
  log "up to date but UNHEALTHY — restarting processes once"
  start_processes || fail "restart failed while up to date"
  sleep 15
  if curl -sf -m 5 "$API_HEALTH" >/dev/null 2>&1 && curl -sf -m 5 "$WEB_HEALTH" >/dev/null 2>&1; then
    log "HEALTHY after restart — nothing to do"
    exit 0
  fi
  fail "UNHEALTHY and already on latest — needs a human, not a rebuild"
fi

if [ "$NEW_COMMIT" = "$PREV_COMMIT" ]; then
  log "tree is at $NEW_COMMIT but the last build was ${LAST_DEPLOYED:-none} — forcing rebuild"
else
  log "deploying $PREV_COMMIT → $NEW_COMMIT"
fi

# Build the web bundle into a staging dir, then swap it in. `next build` wipes
# its output directory, so building straight into `.next` would delete the
# chunks the live server is serving. The swap only happens after a clean
# build; if anything is missing, we fail BEFORE touching the live bundle.
WEB_DIR="$APP_DIR/apps/web"
STAGE_DIR=".next-staging"

build_web_bundle() {
  rm -rf "$WEB_DIR/$STAGE_DIR"
  NEXT_DIST_DIR="$STAGE_DIR" pnpm --filter @aglotrends/web build || return 1
  [ -d "$WEB_DIR/$STAGE_DIR" ] || { log "web build produced no $STAGE_DIR — live bundle left untouched"; return 1; }
  rm -rf "$WEB_DIR/.next.previous"
  if [ -d "$WEB_DIR/.next" ]; then
    mv "$WEB_DIR/.next" "$WEB_DIR/.next.previous" || return 1
  fi
  mv "$WEB_DIR/$STAGE_DIR" "$WEB_DIR/.next" || return 1
  rm -rf "$WEB_DIR/.next.previous"
  return 0
}

rollback() {
  log "health check FAILED — rolling back to $PREV_COMMIT"
  git reset --hard "$PREV_COMMIT"
  pnpm --filter @aglotrends/api build >/dev/null 2>&1 || true
  build_web_bundle >/dev/null 2>&1 || true
  start_processes >/dev/null 2>&1 || true
  fail "rolled back to $PREV_COMMIT — inspect the server, then push a fix"
}

log "installing dependencies…"
pnpm install --frozen-lockfile || fail "pnpm install failed"

log "running database migrations…"
pnpm --filter @aglotrends/database migrate || fail "migrations failed — database untouched by later steps, fix and re-push"

# `drizzle-kit migrate` exits 0 even when a migration file was never in the
# journal (it had nothing to apply and said so). The ledger check is the only
# thing that catches it: every journal entry must have a matching row in
# drizzle.__drizzle_migrations. Abort BEFORE the build if the database is not
# what the code expects.
pnpm --filter @aglotrends/database verify:migrations || fail "migration ledger mismatch — the database is not what the code expects; aborting before the build"

log "building…"
pnpm --filter @aglotrends/engine build || fail "engine build failed"
pnpm --filter @aglotrends/database build || fail "database build failed"
pnpm --filter @aglotrends/api build || fail "api build failed"

log "building web…"
build_web_bundle || fail "web build failed"
log "web bundle swapped into place."

log "restarting services (fresh env)…"
start_processes || fail "process start failed"

log "health-checking (up to 60s)…"
healthy=0
i=0
while [ "$i" -lt 12 ]; do
  sleep 5
  i=$((i + 1))
  if curl -sf -m 5 "$API_HEALTH" >/dev/null 2>&1 && curl -sf -m 5 "$WEB_HEALTH" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  log "health attempt $i/12 not ready yet…"
done
if [ "$healthy" -ne 1 ]; then
  rollback
fi

log "DEPLOYED $NEW_COMMIT — api + web healthy"
echo "$NEW_COMMIT $(date -u +%FT%TZ)" >> deploy.log
