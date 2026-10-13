import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { supabase } from './db.js';
import { createKeepaliveProbe } from './keepalive.js';
import { keepaliveLimiter } from './limiters.js';
import { createSessionMiddleware, configurePassport, passport } from './auth.js';
import { startRoundScheduler } from './roundScheduler.js';
import authRoutes from './routes/auth.js';
import gamesRoutes from './routes/games.js';
import roundsRoutes from './routes/rounds.js';
import suggestionsRoutes from './routes/suggestions.js';
import emailRoutes from './routes/email.js';

const app = express();
app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'img-src': ["'self'", 'data:'],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 3001);

function readClientUrl() {
  const value = process.env.CLIENT_URL || 'http://localhost:5183';
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('CLIENT_URL must use http or https.');
  }
  return url.origin;
}

const clientUrl = readClientUrl();
const runKeepalive = createKeepaliveProbe(supabase);

app.get('/api/health', (_req, res) =>
  res.status(200).json({
    status: 'ok',
    version: process.env.RENDER_GIT_COMMIT || null,
  }),
);

app.get('/api/keepalive', keepaliveLimiter, async (_req, res) => {
  res.set('Cache-Control', 'no-store');

  try {
    const { cached } = await runKeepalive();
    res.status(200).json({ status: 'ok', database: 'reachable', cached });
  } catch (error) {
    console.error('[keepalive]', error);
    res.status(503).json({ status: 'unavailable', database: 'unreachable' });
  }
});

app.use(
  cors({
    origin: clientUrl,
    credentials: true,
  }),
);
app.use(express.json({ limit: '100kb' }));
app.use(createSessionMiddleware());
configurePassport(supabase);
app.use(passport.initialize());
app.use(passport.session());

app.use('/api', authRoutes);
app.use('/api', gamesRoutes);
app.use('/api', roundsRoutes);
app.use('/api', suggestionsRoutes);
app.use('/api', emailRoutes);

app.use(express.static(path.join(root, 'dist')));

app.use('/api', (_req, res) => {
  res.status(404).json({ message: 'Not found.' });
});

app.use((_req, res) => {
  res.sendFile(path.join(root, 'dist', 'index.html'));
});

app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Request body is too large.' });
  }
  if (error instanceof SyntaxError && error?.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Request body must be valid JSON.' });
  }
  console.error('[server]', error);
  res.status(error.status || 500).json({ message: 'Something went wrong. Please try again.' });
});

let schedulerTimer;
let shuttingDown = false;
const server = app.listen(port, () => {
  schedulerTimer = startRoundScheduler(supabase);
  console.log(`Hivemind running on http://localhost:${port}`);
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received; closing gracefully.`);
  if (schedulerTimer) clearInterval(schedulerTimer);

  const forceExitTimer = setTimeout(() => process.exit(1), 10_000);
  forceExitTimer.unref();
  server.close((error) => {
    clearTimeout(forceExitTimer);
    if (error) {
      console.error('[server] Graceful shutdown failed.', error);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
