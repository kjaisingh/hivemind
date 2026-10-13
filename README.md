# Hivemind

[![CI](https://github.com/kjaisingh/hivemind/actions/workflows/ci.yml/badge.svg)](https://github.com/kjaisingh/hivemind/actions/workflows/ci.yml)
[![CodeQL](https://github.com/kjaisingh/hivemind/actions/workflows/codeql.yml/badge.svg)](https://github.com/kjaisingh/hivemind/actions/workflows/codeql.yml)

Hivemind is a private multiplayer guessing game. Players answer independently, then earn points for matching the group. Admins create rounds, mix free-text and multiple-choice questions, share invite links or codes, send reminders, and track season standings.

## How it works

1. An admin creates a game and shares its invite link, QR code, or short code.
2. Players join with an account and answer the active round until its deadline.
3. The server normalizes answers, groups matches, calculates scores, and publishes results after the round closes.
4. Round points and first-place medals roll into the game leaderboard.

Active rounds show only an anonymous `N of M submitted` count. They never reveal who submitted or any answer before results open.

## Stack

- React 19 and Vite 8
- Node.js 22 and Express 5
- Supabase Postgres, accessed server-side with a service-role key
- Passport local authentication with server-side Supabase sessions
- Resend HTTPS API for optional email notifications
- Recharts for lazy-loaded results charts
- Playwright for end-to-end tests and Node's test runner for unit tests
- Render for the production web service

## Local setup

Requirements: Node.js 22+, npm, and a disposable Supabase project.

1. Clone and install dependencies.

   ```bash
   git clone https://github.com/kjaisingh/hivemind.git
   cd hivemind
   npm ci
   ```

2. Create a Supabase project. In its SQL Editor, run [`supabase/schema.sql`](supabase/schema.sql).

3. Copy `.env.example` to `.env` and set at least:

   ```dotenv
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   SESSION_SECRET=a-long-random-value
   ```

4. Start both applications.

   ```bash
   npm run dev
   ```

5. Open `http://localhost:5183`. The API runs on `http://localhost:3001`.

### Optional demo data

> **Destructive:** the seed command deletes every session, game, membership, round, submission, score, and user reachable through cascading deletes. Never point it at a database containing data you need.

Only seed a disposable local/test project. The explicit latch prevents accidental resets:

```dotenv
CONFIRM_DEMO_RESET=RESET_ALL_HIVEMIND_DATA
DEMO_PASSWORD=choose-a-shared-demo-password
```

```bash
npm run setup
```

If `DEMO_PASSWORD` is empty, the script generates one and prints it once. Seeded accounts are `demo@hivemind.app`, `amy@hivemind.app`, `raj@hivemind.app`, and `lee@hivemind.app`. The seeded game code is `HIV-222`.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Supabase project URL, not the `/rest/v1` endpoint. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only key. Never expose it to Vite or browser code. |
| `SESSION_SECRET` | Yes | Long random value used to sign session cookies. |
| `BASE_URL` | Production | Public application origin used in invite links. |
| `CLIENT_URL` | Production | Allowed CORS origin and email call-to-action URL. |
| `VITE_API_URL` | Local only | Backend URL; defaults to `http://localhost:3001` in development. |
| `RESEND_API_KEY` | No | Resend API key. `SMTP_PASS` remains a supported legacy alias. |
| `SMTP_FROM` | No | Sender on a verified Resend domain. |
| `PORT` | No | API/server port; defaults to `3001`. |
| `CONFIRM_DEMO_RESET` | Seed only | Must equal `RESET_ALL_HIVEMIND_DATA` before seeding. |
| `DEMO_PASSWORD` | Seed only | Shared demo-account password; generated when empty. |

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run API and Vite together; either failure stops both. |
| `npm run dev:server` | Run API with Node's built-in watch mode. |
| `npm run dev:client` | Run Vite only. |
| `npm run check` | Syntax check, lint, unit test, and production build. |
| `npm test` | Run fast unit tests. |
| `npm run test:e2e` | Run Playwright against a disposable Supabase project. Never point this at production. |
| `npm run test:ui` | Run deterministic desktop, mobile, and 320px landing/auth smoke tests without a database. |
| `npm run build` | Build the production frontend. |
| `npm start` | Serve API and built frontend. |
| `npm run setup` | Destructively reset and seed demo data after the safety latch is set. |

Playwright starts the API and Vite separately. Missing Supabase credentials therefore fail at backend startup instead of producing a suite of misleading browser `Failed to fetch` errors. Tests mutate and reset data; never run them against production.

## Round and scoring rules

- A game can have at most one active round.
- Only drafts can be edited, deleted, or published.
- A round cannot publish before its configured start or after its expiry.
- Results are private until the scheduler closes and scores the round.
- Players may revise or clear answers before expiry.
- Matching ignores case, punctuation, repeated whitespace, and simple trailing plurals.
- Each answer earns the number of players in its normalized answer group.
- Tied top positive scores share first place and each receive a medal; zero-point ties do not earn medals.

Email delivery is best effort. Manual sends report sent, skipped, and failed counts. Automated messages use delivery-log deduplication. When Resend is not configured, automated sends are skipped before any delivery-log writes and the admin UI shows that email is disabled.

Transient email failures (network errors, timeouts, rate limits, and provider `5xx` responses) may retry. Terminal provider rejections remain deduplicated to avoid retry storms.

## Schema updates

`supabase/schema.sql` is rerunnable for normal setup. Before applying its new uniqueness constraints to an older database, check for conflicts:

```sql
select "gameId", count(*)
from public."Round"
where status = 'ACTIVE'
group by "gameId"
having count(*) > 1;

select "roundId", position, count(*)
from public."Question"
group by "roundId", position
having count(*) > 1;

select "questionId", "normalizedAnswer", count(*)
from public."QuestionAnswerStat"
group by "questionId", "normalizedAnswer"
having count(*) > 1;
```

Resolve any returned rows, then rerun the schema. Application-level guards remain active before the constraints land.

## Deployment

[`render.yaml`](render.yaml) defines a Node 22 Render web service using deterministic `npm ci --include=dev && npm run build`, `npm start`, and `/api/health`. Vite is installed only while building; the running server does not need development dependencies.

1. Create a Render Blueprint from this repository, or configure the same commands manually.
2. Set production values for `BASE_URL`, `CLIENT_URL`, Supabase credentials, and optional Resend credentials.
3. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only.
4. Confirm the GitHub deployment and Render health check use the same commit SHA.

Render's free tier may cold-start after inactivity. Allow a bounded startup window before treating the first `503` as an application failure; repeated probes can trigger provider rate limits.

### Supabase free-tier keepalive

Supabase may pause free projects with insufficient user database activity over seven days. The [Supabase keepalive workflow](.github/workflows/keepalive.yml) calls `GET /api/keepalive` daily at 13:23 UTC. Each uncached call makes three fixed, read-only database queries and returns no database data. Successful probes are cached for six hours to bound traffic to the public endpoint. `/api/health` remains a shallow process check for Render.

The workflow can also run from **Actions → Supabase keepalive → Run workflow**. A `503` response means the database could not be reached; resume the project in Supabase, then run the workflow again.

The endpoint and manual workflow dispatch have been verified. Confirm ongoing scheduled runs under **Actions** after 13:23 UTC. The Supabase Cron callback is the independent long-term trigger.

Production also runs [`supabase/keepalive.sql`](supabase/keepalive.sql) at 01:23 UTC. This Supabase Cron job uses `pg_net` to call the same public endpoint, twelve hours away from the GitHub run. Apply this file only to the production Hivemind project because the callback targets the production Render service.

The two schedules provide independent triggers. The Supabase callback does not depend on GitHub repository activity, while GitHub remains an externally visible failure signal. This matters because GitHub [disables scheduled workflows in public repositories after 60 days without repository activity](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). A separate external scheduler is therefore optional rather than required.

This follows Supabase's current guidance that a few application/API database requests each day are normally enough to avoid pausing, but only a paid plan guarantees the project will never pause. Do not use a high-frequency uptime monitor: it would add no database benefit during the six-hour cooldown and may unnecessarily keep the free Render service awake.

See [Supabase's project pausing documentation](https://supabase.com/docs/guides/platform/free-project-pausing) for current policy details.

## Security and operations

- Row-level security is enabled with no browser-facing policies; only the server uses the service-role key.
- Session cookies are HTTP-only, same-site, and secure in production.
- Auth, join, and email endpoints are rate-limited.
- CI runs source checks, tests, a production build, and a blocking production dependency audit.
- Dependabot opens bounded npm and GitHub Actions updates; CodeQL scans JavaScript.

For a failed deploy, check `/api/health`, Render logs, required environment variables, and Supabase availability in that order.

## Production checklist

1. Run the latest [`supabase/schema.sql`](supabase/schema.sql) in the production Supabase SQL Editor. It is rerunnable and adds the scheduler lookup index without deleting data.
2. In Render, set `BASE_URL` and `CLIENT_URL` to the public HTTPS origin, plus `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a long `SESSION_SECRET`.
3. Optional: set `RESEND_API_KEY` and `SMTP_FROM` from a verified Resend domain. Without them, the game works normally but email controls remain disabled.
4. Deploy `main`, then confirm `/api/health` reports `status: ok` and the expected Render commit in `version`; confirm `/api/keepalive` reports `database: reachable`.
5. Verify the GitHub keepalive workflow succeeds after deployment and confirm its first scheduled run. Do not rerun `npm run setup` against production: it intentionally deletes application data.

## Backlog

Higher-lift ideas intentionally left for future product decisions:

- Voting on player-submitted questions
- Configurable scoring modes
- Scheduled or recurring round publishing
- Co-admin roles
- Web-push notifications
- Bulk email invitations
