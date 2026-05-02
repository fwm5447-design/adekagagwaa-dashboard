# Adekagagwaa Dashboard

Next.js dashboard for the **Adekagagwaa** weather-prediction-market paper
trading bot.  Companion to the bot repo at
[`fwm5447-design/Adekagagwaa`](https://github.com/fwm5447-design/Adekagagwaa).

This is the **Phase 6** dashboard — the cutover from "single-page client
that polls Railway" to "Vercel route handler that reads Supabase analytics
materialized views directly."

## Architecture

```
            ┌──────────────────────────────────────────┐
   browser  │  /login (cookie auth, one-time password) │
   ─────────┤  /        (Dashboard, JSX)               │
            └──────────────────┬───────────────────────┘
                               │  fetch /api/dashboard
                               ▼
            ┌──────────────────────────────────────────┐
   Vercel   │  middleware.js          (JWT verify)     │
   route    │  /api/dashboard         (composite GET)  │
   handler  │  /api/dashboard/[slug]  (per-section)    │
            │  /api/auth/{login,logout}                │
            └──────┬──────────────────────┬────────────┘
                   │ pg (analytics_reader)│ fetch (Bearer)
                   ▼                      ▼
            ┌─────────────┐      ┌──────────────────┐
            │  Supabase   │      │  Railway         │
            │  analytics  │      │  /dashboard.json │
            │  schema     │      │  (v1 live state) │
            └─────────────┘      └──────────────────┘
```

The Vercel handler does two things in parallel on every dashboard load:

1. **Reads the Phase 6 analytics schema directly** via a least-privilege
   Postgres role (`analytics_reader`).  Eight materialized views + one
   regular view, all under `analytics.*`, queried in parallel and merged
   into the `sections` key of the response.
2. **Pass-through fetches the bot's Railway `/dashboard.json`** for live
   operational state (scan_mode, NAV, recent_signals).  This keeps the
   v1 widgets working unchanged during cutover.

The browser never sees the Bearer token to Railway, never sees DB
credentials, and never holds a long-lived JWT in `localStorage`.  A
single HTTP-only signed cookie gates all access.

## Sections served by the route handler

| URL slug       | Materialized view              | Section component       |
| -------------- | ------------------------------ | ----------------------- |
| `calibration`  | `mv_calibration_buckets`       | Oracle                  |
| `sources`      | `mv_source_skill_30d`          | TributaryEnsemble       |
| `signals`      | `mv_signals_funnel_30d`        | DecisionsRendered       |
| `attribution`  | `mv_pnl_attribution`           | RealizedEdge            |
| `vigil`        | `v_burn_in_status` (view)      | Vigil                   |
| `coverage`     | `mv_closing_line_coverage`     | ClosingLineCoverage     |
| `completeness` | `mv_data_completeness`         | DataCompleteness        |
| `health`       | `mv_api_call_health_24h`       | OperationalPulse        |
| `trades`       | `mv_trades_full`               | TradeLedger             |

Each is also reachable individually at `/api/dashboard/<slug>` for
drill-down or external scripted reads.

## Setup — first deploy

### 1. Apply the bot-repo migration

The dashboard reads through a dedicated, least-privilege Postgres role.
Apply migration 025 in the bot repo's Supabase project (paste the entire
contents of the migration into Supabase SQL Editor and run).

Immediately after the migration applies, set the role's password
(don't ship the placeholder):

```sql
ALTER ROLE analytics_reader
    WITH PASSWORD '<32-byte secret from secrets.token_urlsafe(32)>';
```

Construct the database URL value:

```
postgresql://analytics_reader:<password>@db.<project>.pooler.supabase.com:5432/postgres
```

Use the **Transaction-mode** pooler URL.  Look for it in Supabase →
Settings → Database → Connection Pooling → Connection string.

### 2. Set Vercel environment variables

Add these to Production + Preview + Development scopes in Vercel:

```
DATABASE_URL_READER=postgresql://...
DASHBOARD_SITE_PASSWORD=<32-byte secret>
DASHBOARD_JWT_SECRET=<48-byte secret · DIFFERENT from the password>
RAILWAY_DASHBOARD_URL=https://adekagagwaa-production.up.railway.app/dashboard.json
RAILWAY_DASHBOARD_TOKEN=<existing Railway DASHBOARD_AUTH_TOKEN>
```

Generate secrets with:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

**Remove** any previously-set `NEXT_PUBLIC_DASHBOARD_URL` and
`NEXT_PUBLIC_DASHBOARD_TOKEN` — the v2 architecture moves those secrets
server-side.  Leaving them set is harmless but they're unused.

### 3. Install dependencies

```bash
npm install
```

This pulls in two new deps: `pg` (Postgres client) and `jose` (Edge-
compatible JWT).

### 4. Deploy

```bash
vercel --prod
```

### 5. Verify

Open the production URL.  You should see:

1. The login screen ("Lord of the Weather").  Enter the site password.
2. After successful auth, redirect to the dashboard with the v1 status
   band at top, hero KPIs, P&L curve, and the nine analytics sections
   below.
3. Each section's freshness lamp in the left rail should be lit (gold
   if very fresh, amber/violet if stale).

If any section's lamp is coral-colored (failed) or missing, check the
section's `_mv_refreshed_at` in Supabase directly — likely the matching
pg_cron refresh job is paused or the MV hasn't been populated yet.

## Local development

```bash
cp .env.local.example .env.local
# Edit .env.local with real values
npm run dev
```

Open `http://localhost:3000`.

## Theming notes

The theme lives entirely in `app/globals.css` as CSS variables.  Rotating
a token (e.g. changing `--storm-violet` to a different purple) cascades
through every component.  No component hard-codes a hex color.

Fonts are loaded via `next/font/google` in `app/layout.js`:

- **Fraunces** (display + body) — variable font with optical-size axis.
- **JetBrains Mono** (numerics + tables + UI labels).
- **Cormorant SC** (section invocations only — small caps).

The atmospheric parallax cumulus background is pure CSS (60s drift loop,
GPU-accelerated transform, `prefers-reduced-motion: reduce` respected).

## What's deferred

Several lower-frequency follow-ups remain as future work:

- **Tuning controls** (write paths) — the dashboard is read-only by
  design at Phase 6.  Phase 7 will add gated POST endpoints for
  threshold adjustments, Kelly fraction overrides, and refit triggers.
- **Per-city drill-down view** — clicking a city in any section to
  filter the entire dashboard to that city.
- **Export buttons** — CSV/JSON download per section for offline
  analysis.

These are deliberate carve-outs to keep Phase 6 focused on the
read-only analytics surface.
