# Deploying Aglotrends to the aaPanel live server

Target: an Ubuntu VPS with **aaPanel**, **Node.js 22 LTS**, **PostgreSQL 16**,
**Nginx**, **PM2**. The API runs on **:4001**, the web app on **:3200**, both
behind Nginx (reverse proxy + TLS). Ports are chosen to avoid the other apps on
this host (COPINEX API :4000 / web :3100; :3000 belongs to another app).

> **Fill in before running anything:** the domain, the server IP/panel URL, and
> the port block at the top of `deploy.sh`. Everything below assumes
> `APP_DIR=/www/wwwroot/aglotrends`.

---

## 0. What the API needs to boot (non-negotiable)

`apps/api/src/config.ts` **exits the process** in production unless all of these
are real:

| Var | Why |
| --- | --- |
| `JWT_SECRET` | placeholder = forgeable sessions |
| `SECRET_ENCRYPTION_KEY` | missing = gateway secrets stored plaintext |
| `SMTP_URL` | missing = silently dropped reset emails |
| `PAY2CRYPTO_API_URL` + `PAY2CRYPTO_TOKEN` | missing = fake checkouts |
| `PAY2CRYPTO_WEBHOOK_SECRET` | missing = unauthenticated payment webhooks |

Plus `index.ts` verifies the SMTP relay at boot — a dead relay is a **hard crash
in production**. So a deploy without working SMTP and a live Pay2Crypto token
does not produce a running site; it produces a crash loop. That is the guard
working as designed.

---

## 1. One-time server setup (SSH as root)

```sh
# 1. Toolchain (skip what aaPanel already provides)
node -v   # need 20+; pnpm -v; pm2 -v; psql --version
# If missing: install Node 22 LTS + pnpm + pm2 + PostgreSQL 16 via the panel.

# 2. Checkout
git clone https://github.com/Ebankz007/Aglotrends.git /www/wwwroot/aglotrends
cd /www/wwwroot/aglotrends && git checkout main

# 3. Production env — THE secrets live here and ONLY here.
cp apps/api/.env.production.example apps/api/.env
#    Fill every REPLACE_WITH_… value. Generate the secrets:
#      openssl rand -base64 48   -> JWT_SECRET
#      openssl rand -base64 32   -> SECRET_ENCRYPTION_KEY, PAY2CRYPTO_WEBHOOK_SECRET
#    The web app proxies /api/* to the API, so it needs one var:
printf 'NEXT_PUBLIC_API_URL=http://127.0.0.1:4001\n' > apps/web/.env

# 4. Production database + first migration
sudo -u postgres psql -c "CREATE ROLE aglotrends LOGIN PASSWORD '<strong>';"
sudo -u postgres psql -c "CREATE DATABASE aglotrends OWNER aglotrends;"
pnpm install --frozen-lockfile
pnpm --filter @aglotrends/database migrate
# Seed ONLY the permission catalog + your own admin account. NEVER run the dev
# seed-users here: its passwords are published in git history.

# 5. First build + process registration (names must match deploy.sh)
pnpm -r build
pm2 delete aglotrends-api aglotrends-web 2>/dev/null; true
(cd apps/api && pm2 start dist/index.js --name aglotrends-api)
(cd apps/web && pm2 start node_modules/next/dist/bin/next --name aglotrends-web -- start -p 3200)
pm2 save && pm2 startup   # resurrect on reboot

# 6. Prove it before automating
curl -sf http://127.0.0.1:4001/health && curl -sf -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3200/
```

> **Never `pm2 restart` after an env change** — it preserves the stale
> environment. Delete + start (which is exactly what `deploy.sh` does).

---

## 2. Attach the script to the webhook (aaPanel panel)

1. Open the panel → the webhook/hook entry for the site.
2. Paste the contents of `infrastructure/deploy/deploy.sh`, adjusting only the
   `── Configure these ──` block (APP_DIR, ports, PM2 names).
3. Save. Push any commit to `main` → the panel runs it → `deploy.log` in
   `APP_DIR` records every deployment (commit + UTC time).

If the panel's native hook proves inert (as it did for COPINEX on 2026-10-04),
fall back to a 2-minute cron poll that runs the same script — it is idempotent,
so a poll with no new commit costs one health check and nothing else.

---

## 3. Nginx reverse proxy (aaPanel)

aaPanel → Website → Add Site (`<domain>`, PHP = none). Replace the site config
(`/www/server/panel/vhost/nginx/<domain>.conf`) with:

```nginx
server {
    listen 80;
    server_name <domain>;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name <domain>;

    ssl_certificate     /www/server/panel/vhost/cert/<domain>/fullchain.pem;
    ssl_certificate_key /www/server/panel/vhost/cert/<domain>/privkey.pem;

    client_max_body_size 20m;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript image/svg+xml;
    gzip_min_length 1024;

    location /_next/static/ {
        alias /www/wwwroot/aglotrends/apps/web/.next/static/;
        expires 365d;
        add_header Cache-Control "public, immutable";
    }

    # The web app proxies /api/* to the API itself — one origin, one TLS cert,
    # so the httpOnly session cookie is same-origin and there is no CORS.
    location / {
        proxy_pass http://127.0.0.1:3200;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 60s;
    }
}
```

Then **Enable SSL** (Let's Encrypt) in aaPanel for the domain.

---

## 4. Verify end-to-end

1. Push to `main`.
2. GitHub → repo Settings → Webhooks → the hook → Recent Deliveries → the push
   delivery must be green (200).
3. On the server: `tail deploy.log`, both health checks 200, the site loads on
   the domain, and a login round-trip works (cookie set, `/api/me` 200).

## 5. Rollback

Automatic on health-check failure (previous commit + rebuild + restart).
Manual: `cd APP_DIR && git reset --hard <sha> && bash infrastructure/deploy/deploy.sh`.

## 6. Credential hygiene

- The GitHub PAT and the aaPanel API key are in chat history — **treat both as
  burned and rotate them** once the deploy is stable.
- Never put the live Pay2Crypto token, SMTP password, or DB password anywhere
  but the server `.env`.

## 7. Known gaps at first deploy (not blockers, but know them)

- **No legal pages** — Terms / Privacy / Risk Disclosure are "Pending" text.
- **No rate limiting** on auth — login + 2FA are brute-forceable.
- **No monitoring / alerting / DB backup schedule** yet.
- **R1/R2 regulatory posture** is unresolved (recruitment-funded compensation).
