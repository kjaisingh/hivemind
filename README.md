# Hivemind
[![CI](https://github.com/kjaisingh/hivemind/actions/workflows/ci.yml/badge.svg)](https://github.com/kjaisingh/hivemind/actions/workflows/ci.yml)

Hivemind is a multiplayer guessing game where the best answer is the one your group also submits.

## Overview
- **Create and Invite**: One person acts as the game admin, setting up a new game and sharing a custom invite link. Friends, family, or coworkers simply click the link, create an account, and are instantly dropped into the private group.
- **Draft, Then Publish**: Admins build a round's questions as a draft — free to edit or delete it — before publishing it to the group. Players can also suggest questions for the admin to review and promote into a draft round.
- **Answer the Call**: Whenever the admin publishes a round, players log in to face a series of open-ended questions. You can take your time and edit your submissions right up until the round's expiration timer hits zero — a live countdown shows exactly how much time is left, both on the round itself and on the dashboard's active-games list.
- **Think Like the Hive**: Here is the catch—there are no strictly "correct" answers in the traditional sense! Your goal is to submit the exact same answer as the majority of your group. You have to put yourself in your friends' shoes and guess what the most common response will be.
- **Reveal and Score**: Once the deadline passes, the round locks and the results are published. The game automatically groups everyone's answers together and shows a detailed breakdown, with a 🥇 medal for whoever came out on top. Your score for a question is exactly equal to the number of people who guessed the same thing—for example, if you answer "Hydrogen" and 123 other people did too, you bag 124 points!
- **Climb the Ranks**: Every round's points are tallied up into a massive Leaderboard, with medal counts and your own row highlighted. Check your weekly stats, see where your mind diverged from the pack, and accumulate the highest total score across all the active rounds to climb the Season Standings and be crowned the ultimate Hivemind champion!
- **Nudge Stragglers**: Admins can send a one-click reminder email to anyone who hasn't submitted answers for the active round yet, or opt a game into automatic emails for round-open, results-live, and expiring-soon (at configurable hour thresholds) instead.
- **Light or Dark**: A theme toggle (bottom-left) switches between light and dark mode, remembers your choice per browser, and defaults to your OS preference on first visit.

## Known Limitations
- **Reminder emails are best-effort.** Requests to Resend are capped at a 10s timeout, and a failed send for one recipient is logged and skipped rather than blocking the batch or the admin's request — the dedupe record is rolled back so a later retry isn't silently swallowed.
- **Email delivery is sandboxed to the Resend account owner until a domain is verified.** Resend rejects sends to any recipient other than the account owner's own address on accounts with no verified sending domain. To email actual players, verify a domain you control at [resend.com/domains](https://resend.com/domains) and point `SMTP_FROM` at an address on that domain.
- **Automatic reminders fire on the next visit, not the exact hour mark.** Crossed-threshold checks run on a 60s interval plus opportunistically whenever anyone loads a dashboard, round, or results page. Render's free tier spins the service down after ~15min idle, so a threshold crossed while nobody's around fires as soon as the service next wakes up or someone visits. If more than one threshold was crossed while idle, only the most urgent unsent one gets emailed.

## Feature Backlog
- Proactive "round published" notification (email or push), instead of relying on the admin's manual reminder nudge.
- Player up/down-voting on suggested questions, instead of the admin being sole reviewer.
- Configurable scoring (e.g. a bonus for landing on the single most-common answer, not just a flat count).
- Recurring/scheduled round publishing on a cadence, instead of manual publish only.
- Exportable season results (CSV) for archiving past seasons.

## Tech Stack
- **Frontend**: React + Vite
- **Backend**: Node.js + Express
- **Database**: Supabase (PostgreSQL via `@supabase/supabase-js`)
- **Auth**: Passport (Local)
- **Charts**: Recharts
- **Deployment**: Render (single web service)

## Local Development

1. Create a free project at [supabase.com](https://supabase.com), then in the SQL Editor run [`supabase/schema.sql`](supabase/schema.sql).
2. Copy `.env.example` to `.env` and fill in `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` from Project Settings → API. `SUPABASE_URL` is the Supabase **project** URL — not the `/rest/v1/` REST endpoint.
3. Install dependencies and seed demo data.
   ```bash
   npm install
   npm run setup
   ```
4. Start the app.
   ```bash
   npm run dev
   ```
5. Open the app.
   - Frontend: `http://localhost:5183`
   - Backend API: `http://localhost:3001`

### Demo Accounts
All demo users share one password, set via `DEMO_PASSWORD` in `.env` (if unset, `npm run setup` generates one and prints it once — save it):
- `demo@hivemind.app` (admin of demo game)
- `amy@hivemind.app`
- `raj@hivemind.app`
- `lee@hivemind.app`

Seeded game includes:
- 1 active round ready to answer.
- 1 past round with real computed results and leaderboard data.

## Scripts
- `npm run setup` → seed demo data (run `supabase/schema.sql` in Supabase first).
- `npm run dev` → run server and client together (`dev:server` + `dev:client`).
- `npm run dev:server` → server only, with `nodemon` reload.
- `npm run dev:client` → Vite dev server only.
- `npm test` → run the Playwright end-to-end suite (starts its own dev server; see `playwright.config.js`).
- `npm run build` → production frontend build.
- `npm start` → run production server.
- `npm run preview` → preview the production frontend build locally.

## Testing & CI
- `npm test` runs the full Playwright suite against a real browser: auth (signup/login/logout/session
  persistence), a two-browser-context multiplayer round (draft → publish → submit → score →
  leaderboard), reminders, results, and IDOR/security regressions.
- Every push and PR to `main` runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml) on GitHub
  Actions: install, syntax-check all `server/*.js` files, build the client, and a non-blocking
  `npm audit`.

## Deployment

### Blueprint
1. In Render, click **New +** → **Blueprint**.
2. Connect your GitHub repo.
3. Render reads `render.yaml` and creates the service.

### Manual Web Service
- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Runtime: Node 22+
- Health Check Path: `/api/health`
- Set env vars per [Environment Variables](#environment-variables), using the deployed Render URL instead of localhost for `BASE_URL`/`CLIENT_URL`.

Both paths get a dependency-free `GET /api/health` check (`healthCheckPath` in `render.yaml` for the Blueprint path) so Render confirms the service booted before routing traffic to it. It's a deploy-health check, not a keep-alive; the free tier still spins the service down after ~15min idle.


## Environment Variables
Full defaults and comments are in [`.env.example`](.env.example).

- `PORT` — backend port (default `3001`).
- `BASE_URL` — public URL of the backend.
- `CLIENT_URL` — allowed frontend origin.
- `SUPABASE_URL` — Supabase **project** URL (Settings → API → Project URL, e.g. `https://xxxx.supabase.co`) — not the `/rest/v1/` REST endpoint.
- `SUPABASE_SERVICE_ROLE_KEY` — server-only `service_role` key (Settings → API). Bypasses row-level security by design — never expose it client-side.
- `SESSION_SECRET` — random string used to sign session cookies.
- `SMTP_PASS` / `SMTP_FROM` — optional, enables reminder emails via Resend's HTTPS API (`SMTP_PASS` is the Resend API key).
- `DEMO_PASSWORD` — shared password for demo accounts seeded by `npm run setup`.
