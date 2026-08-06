import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { supabase, unwrap } from './db.js';
import { createSessionMiddleware, configurePassport, passport } from './auth.js';
import { requireAuth } from './middleware.js';
import { createGameCode, createInviteToken, normalizeAnswer } from './utils.js';
import { getDashboardData, getGameDetail, getRoundResults } from './repository.js';
import { scoreRound } from './scoring.js';
import { startRoundScheduler, processRounds } from './roundScheduler.js';
import { sendEmail } from './email.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 3001);
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

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

const signUpSchema = z.object({
  email: z.string().email(),
  username: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8),
});

const gameSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().min(2).max(240),
});

const roundSchema = z.object({
  name: z.string().min(1),
  description: z.string().max(240).optional(),
  startsAt: z.string().min(1),
  expiresAt: z.string().min(1),
  questions: z.array(z.string().min(1)).min(1),
});

function buildGameInvite(game) {
  return `${baseUrl}/join/${game.inviteToken}`;
}

async function ensureMembership(gameId, userId, role = 'PLAYER') {
  const existing = unwrap(
    await supabase.from('GameMembership').select('*').eq('gameId', gameId).eq('userId', userId).maybeSingle(),
  );

  if (existing) {
    return existing;
  }

  return unwrap(await supabase.from('GameMembership').insert({ gameId, userId, role }).select().single());
}

async function getRole(gameId, userId) {
  const membership = unwrap(
    await supabase.from('GameMembership').select('*').eq('gameId', gameId).eq('userId', userId).maybeSingle(),
  );
  return membership?.role;
}

async function claimPendingInvite(req, userId) {
  const inviteToken = req.session.pendingInviteToken;
  if (!inviteToken) {
    return { inviteToken: null, game: null };
  }

  const game = unwrap(await supabase.from('Game').select('*').eq('inviteToken', inviteToken).maybeSingle());
  if (game) {
    await ensureMembership(game.id, userId);
  }
  req.session.pendingInviteToken = null;

  return { inviteToken, game };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/public-config', (_req, res) => {
  res.json({
    googleEnabled: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.user) {
    return res.json({ user: null });
  }

  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      username: req.user.username,
    },
  });
});

app.post('/api/auth/signup', async (req, res) => {
  const parsed = signUpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid sign up data.' });
  }

  const { email, username, password } = parsed.data;
  const existingEmail = unwrap(await supabase.from('User').select('*').eq('email', email).maybeSingle());
  const existingUsername = unwrap(await supabase.from('User').select('*').eq('username', username).maybeSingle());
  if (existingEmail || existingUsername) {
    return res.status(400).json({ message: 'Email or username already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = unwrap(await supabase.from('User').insert({ email, username, passwordHash }).select().single());

  req.login(user, async (error) => {
    if (error) {
      return res.status(500).json({ message: 'Failed to login.' });
    }

    const { inviteToken } = await claimPendingInvite(req, user.id);

    return res.json({
      user: { id: user.id, email: user.email, username: user.username },
      pendingInviteToken: inviteToken || null,
    });
  });
});

app.post('/api/auth/login', (req, res, next) => {
  passport.authenticate('local', async (error, user) => {
    if (error || !user) {
      return res.status(400).json({ message: 'Invalid credentials.' });
    }

    req.login(user, async (loginError) => {
      if (loginError) {
        return res.status(500).json({ message: 'Login failed.' });
      }

      const { inviteToken } = await claimPendingInvite(req, user.id);

      return res.json({
        user: { id: user.id, email: user.email, username: user.username },
        pendingInviteToken: inviteToken || null,
      });
    });
  })(req, res, next);
});

app.post('/api/auth/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });
});

app.get('/api/auth/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(400).json({ message: 'Google OAuth is not configured.' });
  }

  const invite = req.query.invite;
  if (invite && typeof invite === 'string') {
    req.session.pendingInviteToken = invite;
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

app.get('/api/auth/google/callback', passport.authenticate('google', { failureRedirect: '/auth?error=google' }), async (req, res) => {
  const { game } = await claimPendingInvite(req, req.user.id);
  if (game) {
    return res.redirect(`${clientUrl}/games/${game.id}`);
  }

  return res.redirect(`${clientUrl}/dashboard`);
});

app.get('/api/join/:inviteToken', async (req, res) => {
  const game = unwrap(await supabase.from('Game').select('*').eq('inviteToken', req.params.inviteToken).maybeSingle());
  if (!game) {
    return res.status(404).json({ message: 'Invite link is invalid.' });
  }

  if (!req.user) {
    req.session.pendingInviteToken = req.params.inviteToken;
    return res.json({ requiresAuth: true, gameName: game.name });
  }

  await ensureMembership(game.id, req.user.id);
  return res.json({ requiresAuth: false, gameId: game.id });
});

app.get('/api/dashboard', requireAuth, async (req, res) => {
  await processRounds(supabase);

  const { memberships, answersByRound } = await getDashboardData(supabase, req.user.id);

  const games = memberships.map(({ role, game, rounds }) => {
    const activeRound = rounds.find((round) => round.status === 'ACTIVE');
    const recentClosed = rounds.filter((round) => round.status === 'CLOSED').slice(0, 3);

    const pending = activeRound
      ? (answersByRound[activeRound.id] || 0) < activeRound.questions.length
      : false;

    return {
      id: game.id,
      role,
      name: game.name,
      description: game.description,
      code: game.code,
      inviteUrl: buildGameInvite(game),
      hasPendingSubmission: pending,
      activeRound: activeRound
        ? {
            id: activeRound.id,
            name: activeRound.name,
            expiresAt: activeRound.expiresAt,
          }
        : null,
      recentClosedRounds: recentClosed.map((round) => ({
        id: round.id,
        name: round.name,
        expiresAt: round.expiresAt,
      })),
    };
  });

  res.json({ games });
});

app.post('/api/games', requireAuth, async (req, res) => {
  const parsed = gameSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid game details.' });
  }

  const code = createGameCode();
  const inviteToken = createInviteToken();

  const game = unwrap(
    await supabase
      .from('Game')
      .insert({
        name: parsed.data.name,
        description: parsed.data.description,
        code,
        inviteToken,
        adminId: req.user.id,
      })
      .select()
      .single(),
  );

  unwrap(await supabase.from('GameMembership').insert({ gameId: game.id, userId: req.user.id, role: 'ADMIN' }));
  unwrap(await supabase.from('GameEmailSettings').insert({ gameId: game.id }));

  res.json({
    game: {
      ...game,
      inviteUrl: buildGameInvite(game),
    },
  });
});

app.post('/api/games/join', requireAuth, async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const game = unwrap(await supabase.from('Game').select('*').eq('code', code).maybeSingle());
  if (!game) {
    return res.status(404).json({ message: 'Game code not found.' });
  }

  await ensureMembership(game.id, req.user.id);
  res.json({ gameId: game.id });
});

app.get('/api/games/:gameId', requireAuth, async (req, res) => {
  await processRounds(supabase);
  const role = await getRole(req.params.gameId, req.user.id);
  if (!role) {
    return res.status(403).json({ message: 'Not part of this game.' });
  }

  const { game, memberships, rounds, emailSettings, scoreMap, medalMap } = await getGameDetail(supabase, req.params.gameId);

  const activeRound = rounds.find((round) => round.status === 'ACTIVE') || null;
  const pastRounds = rounds.filter((round) => round.status === 'CLOSED');
  const draftRounds = rounds.filter((round) => round.status === 'DRAFT');

  const leaderboard = memberships
    .map((membership) => ({
      userId: membership.userId,
      username: membership.user.username,
      points: scoreMap.get(membership.userId) || 0,
      medals: medalMap.get(membership.userId) || 0,
    }))
    .sort((a, b) => b.points - a.points)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  let answers = [];
  if (activeRound) {
    answers = unwrap(
      await supabase
        .from('Submission')
        .select('*')
        .eq('userId', req.user.id)
        .in('questionId', activeRound.questions.map((question) => question.id)),
    );
  }

  res.json({
    game: {
      id: game.id,
      name: game.name,
      description: game.description,
      code: game.code,
      inviteUrl: buildGameInvite(game),
      role,
      activeRound: activeRound
        ? {
            id: activeRound.id,
            name: activeRound.name,
            description: activeRound.description,
            startsAt: activeRound.startsAt,
            expiresAt: activeRound.expiresAt,
            questions: activeRound.questions,
            answers,
          }
        : null,
      leaderboard,
      pastRounds: pastRounds.map((round) => ({
        id: round.id,
        name: round.name,
        expiresAt: round.expiresAt,
      })),
      draftRounds: draftRounds.map((round) => ({
        id: round.id,
        name: round.name,
        startsAt: round.startsAt,
        expiresAt: round.expiresAt,
      })),
      emailSettings,
    },
  });
});

app.post('/api/games/:gameId/active-round/save', requireAuth, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (!role) {
    return res.status(403).json({ message: 'Not part of this game.' });
  }

  const activeRounds = unwrap(
    await supabase
      .from('Round')
      .select('*')
      .eq('gameId', req.params.gameId)
      .eq('status', 'ACTIVE')
      .order('createdAt', { ascending: false })
      .limit(1),
  );
  const round = activeRounds[0];

  if (!round) {
    return res.status(400).json({ message: 'No active round.' });
  }

  if (new Date(round.expiresAt) <= new Date()) {
    await processRounds(supabase);
    return res.status(400).json({ message: 'Round is closed.' });
  }

  const questions = unwrap(await supabase.from('Question').select('*').eq('roundId', round.id));
  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  const validQuestionIds = new Set(questions.map((question) => question.id));

  for (const row of answers) {
    const questionId = row.questionId;
    if (!validQuestionIds.has(questionId)) {
      continue;
    }

    const answer = String(row.answer || '').trim();
    if (!answer) {
      continue;
    }

    unwrap(
      await supabase.from('Submission').upsert(
        {
          questionId,
          userId: req.user.id,
          rawAnswer: answer,
          normalizedAnswer: normalizeAnswer(answer),
        },
        { onConflict: 'questionId,userId' },
      ),
    );
  }

  res.json({ ok: true });
});

app.post('/api/games/:gameId/rounds', requireAuth, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin only.' });
  }

  const parsed = roundSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid round data.' });
  }

  const round = unwrap(
    await supabase
      .from('Round')
      .insert({
        gameId: req.params.gameId,
        name: parsed.data.name,
        description: parsed.data.description,
        startsAt: new Date(parsed.data.startsAt).toISOString(),
        expiresAt: new Date(parsed.data.expiresAt).toISOString(),
        status: 'DRAFT',
      })
      .select()
      .single(),
  );

  unwrap(
    await supabase.from('Question').insert(
      parsed.data.questions.map((question, index) => ({
        roundId: round.id,
        prompt: question,
        position: index + 1,
      })),
    ),
  );

  res.json({ roundId: round.id });
});

app.post('/api/games/:gameId/rounds/:roundId/publish', requireAuth, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin only.' });
  }

  const announcement = String(req.body.announcement || '').trim();

  const round = unwrap(
    await supabase
      .from('Round')
      .update({
        status: 'ACTIVE',
        publishedAt: new Date().toISOString(),
        announcementEmail: announcement,
      })
      .eq('id', req.params.roundId)
      .select()
      .single(),
  );

  const game = unwrap(await supabase.from('Game').select('*').eq('id', round.gameId).maybeSingle());
  const emailSettings = unwrap(
    await supabase.from('GameEmailSettings').select('*').eq('gameId', round.gameId).maybeSingle(),
  );

  if (emailSettings?.autoRoundOpen) {
    const memberships = unwrap(await supabase.from('GameMembership').select('*').eq('gameId', round.gameId));
    const userIds = memberships.map((membership) => membership.userId);
    const users = userIds.length ? unwrap(await supabase.from('User').select('*').in('id', userIds)) : [];

    for (const user of users) {
      await sendEmail({
        to: user.email,
        subject: `${game.name}: ${round.name} is live`,
        intro: announcement || 'A fresh round just opened. Time to read minds and earn points.',
        gameName: game.name,
      });
    }
  }

  res.json({ ok: true });
});

app.put('/api/games/:gameId/email-settings', requireAuth, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin only.' });
  }

  const expiringHours = Array.isArray(req.body.expiringHours)
    ? req.body.expiringHours.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
    : [];

  const settings = unwrap(
    await supabase
      .from('GameEmailSettings')
      .upsert(
        {
          gameId: req.params.gameId,
          autoRoundOpen: Boolean(req.body.autoRoundOpen),
          autoResultsLive: Boolean(req.body.autoResultsLive),
          expiringHoursCsv: expiringHours.join(','),
        },
        { onConflict: 'gameId' },
      )
      .select()
      .single(),
  );

  res.json({ settings });
});

app.post('/api/games/:gameId/email/manual', requireAuth, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin only.' });
  }

  const subject = String(req.body.subject || '').trim();
  const message = String(req.body.message || '').trim();

  const game = unwrap(await supabase.from('Game').select('*').eq('id', req.params.gameId).maybeSingle());
  const memberships = unwrap(await supabase.from('GameMembership').select('*').eq('gameId', req.params.gameId));
  const userIds = memberships.map((membership) => membership.userId);
  const users = userIds.length ? unwrap(await supabase.from('User').select('*').in('id', userIds)) : [];

  for (const user of users) {
    await sendEmail({
      to: user.email,
      subject,
      intro: message,
      gameName: game.name,
    });
  }

  res.json({ ok: true });
});

app.get('/api/games/:gameId/rounds/:roundId/results', requireAuth, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (!role) {
    return res.status(403).json({ message: 'Not part of this game.' });
  }

  await processRounds(supabase);

  const { round, game, scores, questions } = await getRoundResults(supabase, req.params.roundId, req.user.id);

  const ownScoreRow = scores.find((score) => score.userId === req.user.id);
  const ownScore = ownScoreRow
    ? { totalScore: ownScoreRow.totalScore, rank: ownScoreRow.rank, medalAwarded: ownScoreRow.medalAwarded }
    : { totalScore: 0, rank: scores.length + 1 };

  res.json({
    round: {
      id: round.id,
      name: round.name,
      gameName: game.name,
      ownScore,
      leaderboard: scores.map((score) => ({
        userId: score.userId,
        username: score.user.username,
        totalScore: score.totalScore,
        rank: score.rank,
      })),
      questions: questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        yourAnswer: question.submissions[0]?.rawAnswer || '',
        stats: question.answerStats,
      })),
    },
  });
});

app.use(express.static(path.join(root, 'dist')));
app.use((_req, res) => {
  res.sendFile(path.join(root, 'dist', 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error('[server]', error);
  res.status(500).json({ message: 'Something went wrong. Please try again.' });
});

app.listen(port, async () => {
  await processRounds(supabase);
  startRoundScheduler(supabase);
  console.log(`Hivemind running on http://localhost:${port}`);
});
