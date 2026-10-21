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
# One-shot jobs that need shell access on the box (credential liveness, gateway
# contract drift, clearing dead invoices). Bump an id to run one again; "" turns
# it off. Each id runs exactly once — the sentinel records the last id that ran.
DIAG_P2C_ID="p2c-probe-5"
DIAG_PAYMENTS_ID="cleanup-2"
# Callback reconciliation: cross-references our ledger against the gateway's
# own record for every recent payment (read-only — it creates no request).
DIAG_WEBHOOK_ID="wh-2"
# What does the gateway say about its own webhooks and deliveries?
DIAG_WEBHOOK_CONFIG_ID="whcfg-1"
# Reconcile: what does the GATEWAY say about our PENDING invoices? Read-only
# by default (the script only settles when it is given --apply AND the gateway
# confirms the money moved).
DIAG_RECONCILE_ID="rec-1"
# ── The reconciliation loop ─────────────────────────────────────
# The callback is the fast path; this is the ground truth path. The gateway
# delivered twice in four hours and NOT AT ALL for the one payment that
# mattered, and it exposes no API for its own webhook state - so a dead
# webhook would strand members silently, forever. Every cycle we ask the
# gateway what it says about OUR references and act only on its explicit word:
# confirmed + amount/network/settlement agree -> settle; expired-and-unpaid ->
# release; ambiguous -> touch nothing.
#
# The script throttles itself, because the deploy cron runs every 2 minutes
# and the gateway is a third party with its own rate limits.
RECONCILE_EVERY_MIN=10
# The USDT rails the merchant account can actually serve. The account is the
# authority: a rail with no receiving address on the gateway is refused by the
# gateway, so offering it breaks the member's payment. Verified against the
# live account: TRC20 (2 receiving addresses) and BEP20 (1) exist; ERC20 has
# none until an address is added in the Pay2Crypto dashboard.
SYNC_NETWORKS="trc20,bep20"
# ── TEMPORARY: the callback capture window ──────────────────
# Pay2Crypto signs every callback (`x-p2c-signature: t=…,v1=…`) but publishes
# no signing string, and the endpoint used to demand a shared-secret header
# the gateway never sends — so every real callback was answered 401 and a
# confirmed payment never activated the member's dashboard.
#
# While this is "1", the API logs the raw body of a callback it could not
# verify, so the scheme is derived from evidence instead of guessed. REMOVE
# THIS LINE once the scheme is pinned by a test — a production log should not
# keep bodies for longer than the investigation needs them.
WEBHOOK_CAPTURE="1"
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

# ── One-shot diagnostics ─────────────────────────────────
# Run AFTER the reset (the script must exist on disk) and BEFORE the
# early-exit below, so a job still runs when there is nothing to deploy.
# A failing job never fails the deploy.
run_diag() {
  _name="$1"; _script="$2"; _id="$3"; shift 3
  [ -n "$_id" ] || return 0
  [ -f "$_script" ] || { log "diagnostic $_name: script missing, skipping"; return 0; }
  _sentinel="/tmp/aglotrends-diag-$_name.done"
  if [ "$(cat "$_sentinel" 2>/dev/null || echo none)" != "$_id" ]; then
    log "running diagnostic $_name ($_id)"
    ( node "$_script" "$@" ) || log "diagnostic $_name exited non-zero (continuing)"
    echo "$_id" > "$_sentinel"
  fi
}
run_diag p2c "$APP_DIR/database/scripts/diagnose-p2c.mjs" "$DIAG_P2C_ID"
run_diag payments "$APP_DIR/database/scripts/expire-mock-payments.mjs" "$DIAG_PAYMENTS_ID" --apply
run_diag webhook "$APP_DIR/database/scripts/diagnose-webhook.mjs" "$DIAG_WEBHOOK_ID"
run_diag reconcile "$APP_DIR/database/scripts/reconcile-payment.mjs" "$DIAG_RECONCILE_ID"
run_diag webhook_config "$APP_DIR/database/scripts/diagnose-webhook-config.mjs" "$DIAG_WEBHOOK_CONFIG_ID"

# ── The reconciliation loop ───────────────────────────────────
# Standing job, not a one-shot: it runs on every cycle and throttles itself.
# It is placed here (after the reset, before the early-exit) so a member is
# activated even when there is nothing to deploy.
if [ -f "$APP_DIR/database/scripts/reconcile-payment.mjs" ]; then
  log "reconciling the payment ledger against the gateway."
  ( node "$APP_DIR/database/scripts/reconcile-payment.mjs" --apply --throttle-min="$RECONCILE_EVERY_MIN" ) \
    || log "reconcile exited non-zero (continuing)"
else
  log "reconcile: script missing, skipping"
fi

# ── Publish the console credential into the runtime env ──
# The API is env-only: it reads PAY2CRYPTO_* from apps/api/.env and never
# from the database. The console stores the credential encrypted in
# app_config. Without this step the credential Henry configured sits in the
# database while the API serves the mock rail - which is exactly what
# happened for months. The sync runs on every deploy, BEFORE the API starts.
# Exit 42 means "the environment changed" -> the API must restart to load it.
GATEWAY_ENV_CHANGED=0
if [ -f "$APP_DIR/database/scripts/sync-gateway-env.mjs" ]; then
  log "syncing the gateway credential into the runtime environment"
  set +e
  node "$APP_DIR/database/scripts/sync-gateway-env.mjs" --apply --networks="$SYNC_NETWORKS" --webhook-capture="$WEBHOOK_CAPTURE"
  _sync_rc=$?
  set -e
  if [ "$_sync_rc" -eq 42 ]; then
    GATEWAY_ENV_CHANGED=1
    log "gateway environment changed - the API will be restarted to load it"
  elif [ "$_sync_rc" -ne 0 ]; then
    log "gateway credential sync failed (rc=$_sync_rc) - continuing with the current environment"
  fi
fi

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
  if [ "$GATEWAY_ENV_CHANGED" -eq 1 ]; then
    log "tree is current but the gateway credential changed — restarting to load it"
    start_processes || fail "restart failed while up to date"
    sleep 15
    if curl -sf -m 5 "$API_HEALTH" >/dev/null 2>&1 && curl -sf -m 5 "$WEB_HEALTH" >/dev/null 2>&1; then
      log "HEALTHY after restart — nothing to do"
      exit 0
    fi
    fail "UNHEALTHY after the credential restart — needs a human"
  fi
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
