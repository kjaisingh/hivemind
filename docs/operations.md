# Hivemind operations

This is for maintainers. The [README](../README.md) describes the game, not its deployment.

## Local development

Use Node.js 22+, npm, and a disposable Supabase project. Apply [`supabase/schema.sql`](../supabase/schema.sql) in that project's SQL Editor. Copy [`.env.example`](../.env.example) to `.env`, then set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a long random `SESSION_SECRET`. Never expose the service-role key through a `VITE_` variable.

Run `npm ci` and `npm run dev`; open `http://localhost:5183`. `npm run check` covers syntax, lint, unit tests, and build. `npm run test:ui` does not need a database. `npm run test:e2e` changes database data and must use a disposable project. `npm run setup` deletes existing Hivemind data before seeding; it requires `CONFIRM_DEMO_RESET=RESET_ALL_HIVEMIND_DATA` and must never run against production.

## Production

[`render.yaml`](../render.yaml) builds and serves the app. Render needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `BASE_URL`, and `CLIENT_URL`; the last two must be the public HTTPS app origin. Optional `RESEND_API_KEY` and `SMTP_FROM` enable email from a verified sender domain. Without them, gameplay still works and email controls remain disabled.

Render deploys do not apply SQL. Review database changes separately, make a backup before a data-changing migration, and never rerun the demo seed against production. The answer-stat uniqueness repair script exists for older databases with duplicates; it is not a routine deployment step. Hivemind production had zero duplicate groups and the unique index on October 15, 2026.

Supabase Free has no managed database backups. If the data matters, keep an independent encrypted logical export and test restoring it to a disposable project. Do not put a database dump or service-role key in a public repository or unencrypted CI artifact.

## Availability checks

Two daily jobs call `/api/keepalive`: [Supabase Cron](../supabase/keepalive.sql) at 01:23 UTC and [GitHub Actions](../.github/workflows/keepalive.yml) at 13:23 UTC. The endpoint makes bounded, read-only database requests and caches a successful result for six hours. Its `checkedAt` field is the time of the last real database read; `cached: true` does not mean a fresh read happened. GitHub schedules can be disabled after prolonged repository inactivity, so check both schedulers periodically. Supabase Cron job success means its HTTP request was queued; check `net._http_response` or the endpoint for the HTTP result.

`/api/health` reports the deployed commit SHA but does not probe the database. `/api/keepalive` reports database reachability. These checks reduce free-tier inactivity pauses; they cannot guarantee uptime, prevent Render cold starts, or replace backups. If Supabase pauses, resume it in the dashboard and verify an uncached database probe before using the game.
