# Hivemind
Hivemind is a multiplayer guessing game where the best answer is the one your group also submits.

## Overview
TODO


## Feature Backlog
- Send suggested questions to admins.


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
- `BASE_URL` (your public backend URL).
- `CLIENT_URL` (your public frontend URL; same URL for this deployment).
- `SESSION_SECRET` (a long random string).
- Google OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`.
- Email sending: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
