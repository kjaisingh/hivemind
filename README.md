# Hivemind

Hivemind is a multiplayer guessing game. Answer as you think your group will answer, then see whose answers match and how you rank across a season. [Play Hivemind](https://hivemind-ev7a.onrender.com).

## Features

- Create or join a game with a code, invite link, or QR code.
- Play host-published rounds with free-text and multiple-choice questions; revise answers until the deadline. Game and dashboard updates refresh automatically while visible.
- Suggest questions, or host a game by drafting, editing, and publishing rounds.
- Earn points for matching answers and follow round results, medals, and the season leaderboard.
- Explore answer counts and charts, and download aggregate results as CSV.
- Send optional email announcements and reminders; use the mobile-friendly light or dark interface.

## Architecture

- React and Vite provide the client; Express handles authentication, game rules, and API requests.
- Supabase Postgres stores users, games, rounds, answers, and results.
- An in-process scheduler closes rounds and handles reminders. One Render service serves the client and API.
- Resend provides optional email delivery. Automatic notifications run every minute; transient failures retry while a round is active or for 24 hours after its deadline.

## Setup

1. Install Node.js 22 or newer and create a Supabase project. Run [`supabase/schema.sql`](supabase/schema.sql) in its SQL Editor.
2. Copy the environment template, then set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a random `SESSION_SECRET` in `.env`.

   ```bash
   cp .env.example .env
   ```

3. Install dependencies and start the app at <http://localhost:5183>.

   ```bash
   npm ci
   ```

   ```bash
   npm run dev
   ```

4. For deployment, create a Render Blueprint from [`render.yaml`](render.yaml). Set the Supabase values and `BASE_URL` and `CLIENT_URL` to the public HTTPS origin. Render generates `SESSION_SECRET`.
5. To enable email, configure `RESEND_API_KEY` and `SMTP_FROM` for a verified sender.

## Feature backlog

- Add automatic opening for future rounds.
- Add reusable question packs and bulk question import.
- Let hosts assign co-hosts with limited permissions.
- Add optional device notifications for round openings and deadlines.
- Move scheduling outside the web process and add automated backups and failure alerts.
