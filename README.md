# Hivemind
Hivemind is a multiplayer guessing game where the best answer is the one your group also submits.


## Overview
- **Create and Invite**: One person acts as the game admin, setting up a new game and sharing a custom invite link. Friends, family, or coworkers simply click the link, create an account, and are instantly dropped into the private group.
- **Answer the Call**: Whenever the admin kicks off a new round, players log in to face a series of open-ended questions. You can take your time and edit your submissions right up until the round's expiration timer hits zero.
- **Think Like the Hive**: Here is the catch—there are no strictly "correct" answers in the traditional sense! Your goal is to submit the exact same answer as the majority of your group. You have to put yourself in your friends' shoes and guess what the most common response will be.
- **Reveal and Score**: Once the deadline passes, the round locks and the results are published. The game automatically groups everyone's answers together and shows a detailed breakdown. Your score for a question is exactly equal to the number of people who guessed the same thing—for example, if you answer "Hydrogen" and 123 other people did too, you bag 124 points!
- **Climb the Ranks**: Every round's points are tallied up into a massive Leaderboard. Check your weekly stats, see where your mind diverged from the pack, and accumulate the highest total score across all the active rounds to climb the Season Standings and be crowned the ultimate Hivemind champion!


## Feature Backlog
- Send player-suggested questions to admins.
- Image/media support for questions.
- Visual countdown timer showing when the active round expires.
- Automated email triggers to notify players when rounds open, are about to close, or when results are ready.
- One-click admin reminders to nudge players who haven't submitted their answers yet.
- Profile badges for players who placed first in previous individual rounds.
- Draft mode for admins to build and save upcoming rounds.
- Seasonal reset button to archive the current leaderboard and start a fresh season without needing a new invite link.
- LLM-based answer normalization to automatically merge minor typos or semantic variations.
- LLM-based answer clustering to automatically group similar responses together.


## Tech Stack
- Frontend: React + Vite.
- Backend: Node.js + Express.
- Database: Prisma + SQLite.
- Auth: Passport (Local + Google OAuth).
- Charts: Recharts.
- Hosting: Render (single web service).


## Local Development
### Quick Start
From this folder:
```bash
npm install
npm run setup
npm run dev

```
Then open:
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3001/api/health`

### Demo Accounts
All demo users use password `password123`:
- `demo@hivemind.app` (admin of demo game)
- `amy@hivemind.app`
- `raj@hivemind.app`
- `lee@hivemind.app`

Seeded game includes:
- 1 active round ready to answer.
- 1 past round with real computed results and leaderboard data.


## Deployment
### Blueprint
1. In Render, click **New +** → **Blueprint**.
2. Connect your GitHub repo.
3. Render reads `render.yaml` and creates the service.

### Render Environment Variables
After first deploy, set:
- `BASE_URL=https://<your-render-service>.onrender.com`
- `CLIENT_URL=https://<your-render-service>.onrender.com`
- `GOOGLE_CALLBACK_URL=https://<your-render-service>.onrender.com/api/auth/google/callback` (only if Google OAuth enabled)
Redeploy after updating variables.


## API Keys & Credentials
### Google OAuth keys (optional)
1. Go to Google Cloud Console.
2. Create/select a project.
3. Enable **Google Identity Services** or OAuth consent setup.
4. Create OAuth Client ID for **Web application**.
5. Add authorized redirect URI:
   - `https://<your-render-service>.onrender.com/api/auth/google/callback`
6. Copy values into Render:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`

### SMTP credentials (optional)
Use any SMTP provider (Resend, SendGrid, Mailgun, Postmark, etc):
1. Create an account and sender identity/domain.
2. Get SMTP host, port, username, password.
3. Set in Render:
   - `SMTP_HOST`
   - `SMTP_PORT`
   - `SMTP_USER`
   - `SMTP_PASS`
   - `SMTP_FROM`


## Scripts
- `npm run setup` → initialize DB schema + seed demo data.
- `npm run dev` → run server and client together.
- `npm run build` → production frontend build.
- `npm start` → run production server.


## Environment Variables
- `BASE_URL`.
- `CLIENT_URL`.
- `SESSION_SECRET`.
- Google OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`.
- Email sending: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
