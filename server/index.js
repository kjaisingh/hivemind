import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { supabase } from './db.js';
import { createSessionMiddleware, configurePassport, passport } from './auth.js';
import { startRoundScheduler, processRounds } from './roundScheduler.js';
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
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';

app.use(
  cors({
    origin: clientUrl,
    credentials: true,
  }),
);
app.use(express.json());
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
  console.error('[server]', error);
  res.status(error.status || 500).json({ message: 'Something went wrong. Please try again.' });
});

app.listen(port, async () => {
  await processRounds(supabase);
  startRoundScheduler(supabase);
  console.log(`Hivemind running on http://localhost:${port}`);
});
