# Aglotrends — Concept

*Living document. Rewritten as the concept sharpens. Every locked decision carries a date.*

Last updated: 2026-10-10

---

## 1. One-line definition

> **Aglotrends is a four-pillar trading platform — Copy Trading, Signal Service, a
> Referral/Network economy, and a Trader Community — wired together by a single compensation
> engine.** Copy trading and signals are **manually operated**; the platform is the ledger,
> the network, and the delivery surface, not the trade router.

---

## 2. Locked decisions

| Date | Decision | Implication |
|------|----------|-------------|
| 2026-10-10 | **No jurisdiction / licence needed.** Aglotrends operates as a software/education layer and partners with any broker by adding the broker link from the backend. | No broker API integration. No custody. The platform never touches client funds. |
| 2026-10-10 | **Copy trading is manual.** The copy action happens on the broker site. | Aglotrends stores broker links + the client's linked-account record; it does NOT mirror trades or read positions. |
| 2026-10-10 | **Signals are manual.** Authored/pasted from the backend; clients see them on their dashboard, with notification to email / WhatsApp / Telegram. | Signals = admin-authored content + a notification fan-out. No signal engine/strategy automation. |
| 2026-10-10 | **The compensation plan is not final** — it can be redesigned as we proceed. | The engine is parameterised by constants; changing the plan is a constants/migration change, not a rewrite. |
| 2026-10-10 | **Build the complete system** — admin area, client area, and all engines. | Full monorepo: engine + database + API + web (client + admin). |

---

## 3. The four pillars (as built)

| # | Pillar | What it is | Manual or automated |
|---|--------|-----------|---------------------|
| 1 | **Copy Trading** | Admin maintains a list of **broker links**. A client picks one, registers/copies **on the broker's own site**, then records their account in Aglotrends for tracking. Admin verifies. | **Manual** (on the broker site) |
| 2 | **Signal Service** | Admin authors a signal (instrument, direction, entry/SL/TP, notes). It publishes to the client dashboard and fans out to **email / WhatsApp / Telegram**. | **Manual authoring**, automated delivery |
| 3 | **Referral / Network** | One-time $20 registration fee split across direct-referral, generation, rank, and leadership pools, placed on a forced 3×3 matrix. | **Automated** (the engine) |
| 4 | **Trader Community** | Leaderboards, recognition ranks, signal history, member directory. | Automated (derived) |

### Money-flow map

```
Registration ($20, one-time)
  ├─ 45%  Company Operating Reserve          ($9.00)
  └─ 55%  Community Rewards Pool             ($11.00)
            ├─ 30%  Direct Referral Bonus     ($6.00)  -> instant, sponsor
            ├─ 10%  Generation Bonus 2–6      ($2.00)  -> instant, upline
            ├─  8%  Rank Bonus Pool           ($1.60)  -> accrues, milestone
            └─  7%  Leadership Bonus Pool     ($1.40)  -> accrues, milestone

Trading profit (per settlement period, realized only, if > 0)
  ├─ 60%  Client
  ├─ 10%  Sponsor Override
  └─ 30%  Company
```

---

## 4. The data problem this creates (flagged)

Because **copy trading is manual and runs on the broker site**, Aglotrends has **no live feed**
of a client's trading results. But §7 of the compensation plan splits *realized trading profit*
60/10/30 — which means something must tell the platform what the realized profit was.

Three ways to close that gap, in order of my preference:

1. **Admin-entered settlement (recommended for v1).** Admin records each client's realized
   profit per settlement period (from the broker's statement). The engine splits it. Auditable,
   simple, honest — the admin is the source of truth. *This is the default in the schema.*
2. **Broker statement import.** Admin uploads a CSV/PDF statement; platform parses it. More work,
   same trust model.
3. **Broker API feed.** Automated, but that is exactly the integration the "no licence / manual"
   decision was designed to avoid. Deferred.

> **Until this is decided, the profit-share engine has no input.** I am building the
> admin-entered path (§4.1) now because it needs no new decisions and is the safest default.

---

## 5. Architecture (as built)

pnpm workspace monorepo, mirroring the COPINEX conventions (integer-cents money math, Drizzle,
Vitest, Express + Next 15).

```
Aglotrends/
  packages/
    engine/     pure TS — compensation + network engine (58 tests, green)
  database/     Drizzle schema + migrations + seeds
  apps/
    api/        Express REST API — thin adapters over the engine; jobs; notification fan-out
    web/        Next.js 15 — (marketing) · (portal) client area · (admin) admin area
  docs/         concept, compensation plan (MD/HTML/PDF)
```

**Engine modules** (done): constants, types, money, allocation, network, compression, bonuses,
matrix, ranks, pools. Every downstream layer is a thin adapter over these functions.

**Still to build:** database schema, API + services + jobs, client area, admin area, notification
channels (email / WhatsApp / Telegram).

---

## 6. Risk map

| # | Risk | Why it matters | Status |
|---|------|----------------|--------|
| R1 | **Regulatory classification** | Henry's position: software/education, no licence. **My honest caveat:** positioning reduces exposure but does not erase it — a plan that pays recruitment bonuses can still be characterised as a pyramid regardless of what the app calls itself. | **Decision taken; residual risk noted** |
| R2 | **Pyramid / Ponzi characterization** | 55% of every fee is redistributed as network bonuses; income is recruitment-linked. | **Open (structural)** |
| R3 | **"Trading profit" as a de facto return** | UI copy must never imply a fixed/guaranteed return. | **Design constraint** |
| R4 | **Non-cash leadership rewards** | Vehicles/housing promised from an underfunded pool. | **Open** |
| R5 | **AML/KYC + NDPR data privacy** | Even as software, you hold personal data and broker-account references. | **Open** |
| R6 | **Broker/custody relationship** | Client funds stay at the broker — good for R1; the legal chain must be stated in the Member Agreement. | **Open** |
| R7 | **Pool solvency engineering** | Engine hard-stops and flags underfunded payouts. | **Built (engine); admin queue pending** |
| R8 | **Profit-settlement data source** | Manual copy = no live P&L feed (§4). | **Open — see §4** |

---

## 7. Open questions for Henry

1. **Profit settlement input** — confirm the admin-entered path (§4.1), or pick statement import?
2. **Notification providers** — which email (SMTP), WhatsApp (Cloud API / Twilio), and Telegram
   (bot token) do you want wired? I'll build adapters that no-op when unconfigured.
3. **Signal scope** — free to all members, or gated (e.g. paid tier / active members only)?
4. **Member funding** — since copy is on the broker site, does Aglotrends ever handle money for the
   $50 minimum, or is that entirely at the broker? (Affects whether we need payments at all.)

---

## 8. Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-10 | Repository scaffolded at `C:\BerfamWorks\Aglotrends` | Concept precedes architecture |
| 2026-10-10 | Four pillars: Copy Trading · Signal Service · Referral/Network · Trader Community | Henry's direction |
| 2026-10-10 | COPINEX compensation reference rebranded to Aglotrends; green → blue | Source document supplied by Henry |
| 2026-10-10 | Software/education posture; no licence; partner brokers via backend links | Henry's decision |
| 2026-10-10 | Copy + signals are manual | Henry's decision |
| 2026-10-10 | Stack: pnpm workspace, engine (pure TS) + database (Drizzle) + api (Express) + web (Next 15) | Matches COPINEX; engine-first |
| 2026-10-10 | Compensation engine built and green (58 tests) | The risk centre, proven first |

---

## 9. Conversation log

- **2026-10-10** — Henry opened the Aglotrends thread; scaffolded the project.
- **2026-10-10** — Henry supplied the compensation-plan PDF; rebranded to Aglotrends (green→blue),
  delivered as MD/HTML/PDF; reframed the concept as four pillars + risk map.
- **2026-10-10** — Henry: no licence needed (software/education), plan is not final, build the
  complete system. → Stack locked, compensation engine built and tested green.
- **2026-10-10** — Henry: copy is manual on the broker site; signals are manual, authored in the
  backend, delivered to dashboard + email/WhatsApp/Telegram. → Architecture adjusted; profit-
  settlement data gap flagged (§4).
