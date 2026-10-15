# Hivemind

Hivemind is a multiplayer guessing game: answer as you think your group will answer, then see how many minds matched yours.

[Play Hivemind](https://hivemind-ev7a.onrender.com)

## How to play

1. Create an account, then create a game or join one with a code, invite link, or QR code.
2. Answer each round's free-text and multiple-choice questions before the deadline. You can revise your answers while the round is open.
3. Once the round closes, compare answers, see your points and rank, and follow the season leaderboard.

## For players and hosts

- Players can suggest questions for a future round and see which active games still need their answers.
- Hosts can create and edit draft rounds, choose questions and deadlines, publish rounds, and review player suggestions.
- Invite links, short codes, and QR codes make it easy to bring a group together.
- Results show answer counts and percentages, with charts and an accessible text summary.
- Optional email announcements and reminders are available when email delivery is enabled.
- The interface works on desktop and mobile, with light and dark themes.

## Scoring and visibility

Each answer earns one point for every player who gave the same normalized answer, including you. Matching ignores case, punctuation, repeated spaces, and simple plurals. Round points accumulate on the season leaderboard. Players tied for first on a round earn a medal if their score is above zero.

While a round is open, players see only how many people have submitted, not anyone else's answers. Answers and results become visible after the round closes.

Round results include a CSV download of answer totals and percentages. It contains no individual player answers.

## Run locally

Requires Node.js 22+, npm, and a disposable Supabase project. Run [`supabase/schema.sql`](supabase/schema.sql) in that project's SQL Editor, then copy [`.env.example`](.env.example) to `.env` and set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a long random `SESSION_SECRET`. Keep the service-role key server-side; never put it in a `VITE_` variable.

```bash
npm ci
npm run dev
```

Open `http://localhost:5183`. The API runs on port 3001. `npm run check` runs syntax, lint, unit tests, and the production build. `npm run test:ui` runs browser checks without a database; `npm run test:e2e` changes database data and requires a disposable Supabase project.

`npm run setup` deletes existing Hivemind data and seeds demo accounts. Use it only on a disposable project after explicitly setting `CONFIRM_DEMO_RESET=RESET_ALL_HIVEMIND_DATA`. The value in `.env.example` is blank by default.

## Production operations

[`render.yaml`](render.yaml) deploys the Node server and built frontend. Render needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `BASE_URL`, and `CLIENT_URL`; the last two are the public HTTPS application origin. `RESEND_API_KEY` and `SMTP_FROM` enable optional email from a verified sender domain. Without them, gameplay still works and email controls stay disabled.

Apply [`supabase/schema.sql`](supabase/schema.sql) before deploying code that depends on new schema. The file is rerunnable. If its answer-stat unique index reports duplicate rows, run [`supabase/repair-question-answer-stat-duplicates.sql`](supabase/repair-question-answer-stat-duplicates.sql) first. That repair archives affected derived rows in `maintenance.question_answer_stat_duplicate_backup` and stops without changes when conflicting values need review. Never run the demo seed against production.

Supabase Free does not include managed database backups. Keep an independent, encrypted logical export of production data and test restoring it into a disposable project. Leave the repair archive in place until you have verified the results and have an external backup.

Two daily keepalive paths call the public `/api/keepalive` endpoint: [GitHub Actions](.github/workflows/keepalive.yml) at 13:23 UTC and [Supabase Cron](supabase/keepalive.sql) at 01:23 UTC. The endpoint makes bounded read-only database requests and caches success for six hours. Check recent GitHub workflow runs and the active `hivemind-keepalive` Cron job after setup. GitHub may disable schedules in inactive public repositories; the Supabase job is the independent trigger. These checks reduce inactivity pauses but cannot guarantee availability under Supabase's Free plan or during provider outages.

For a production check, `/api/health` should report `status: ok` and the deployed commit SHA; `/api/keepalive` should report `database: reachable`. A response with `cached: true` is normal within the cooldown. If Supabase has already paused, resume it in the dashboard and rerun the GitHub keepalive workflow. Confirm the database works again before using the game.
