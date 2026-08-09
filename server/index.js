import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { supabase, unwrap } from './db.js';
import { createSessionMiddleware, configurePassport, passport } from './auth.js';
import { requireAuth } from './middleware.js';
import { createGameCode, createInviteToken, normalizeAnswer } from './utils.js';
import dayjs from 'dayjs';
import { getDashboardData, getGameDetail, getRoundResults, getSuggestionsForGame } from './repository.js';
import { startRoundScheduler, processRounds, sendWithDedup } from './roundScheduler.js';
import { sendEmail } from './email.js';

const app = express();
app.set('trust proxy', 1);
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
  email: z.string().email().toLowerCase(),
  username: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(72),
});

const gameSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().min(2).max(240),
});

const roundSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().max(240).optional(),
    startsAt: z.string().min(1),
    expiresAt: z.string().min(1),
    questions: z.array(z.string().min(1).max(240)).min(1).max(20),
  })
  .refine((data) => !Number.isNaN(new Date(data.startsAt).getTime()), {
    message: 'Invalid start date.',
    path: ['startsAt'],
  })
  .refine((data) => !Number.isNaN(new Date(data.expiresAt).getTime()), {
    message: 'Invalid expiry date.',
    path: ['expiresAt'],
  });

const suggestionSchema = z.object({
  prompt: z.string().min(1).max(240),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again later.' },
});

const joinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again later.' },
});

const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many emails sent. Please try again later.' },
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

app.post('/api/auth/signup', loginLimiter, async (req, res) => {
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

  req.login(user, (error) => {
    if (error) {
      return res.status(500).json({ message: 'Failed to login.' });
    }

    claimPendingInvite(req, user.id)
      .then(({ inviteToken }) => {
        res.json({
          user: { id: user.id, email: user.email, username: user.username },
          pendingInviteToken: inviteToken || null,
        });
      })
      .catch(() => {
        res.status(500).json({ message: 'Failed to complete sign up.' });
      });
  });
});

app.post('/api/auth/login', loginLimiter, (req, res, next) => {
  if (typeof req.body.email === 'string') {
    req.body.email = req.body.email.toLowerCase();
  }

  passport.authenticate('local', (error, user) => {
    if (error || !user) {
      return res.status(400).json({ message: 'Invalid credentials.' });
    }

    req.login(user, (loginError) => {
      if (loginError) {
        return res.status(500).json({ message: 'Login failed.' });
      }

      claimPendingInvite(req, user.id)
        .then(({ inviteToken }) => {
          res.json({
            user: { id: user.id, email: user.email, username: user.username },
            pendingInviteToken: inviteToken || null,
          });
        })
        .catch(() => {
          res.status(500).json({ message: 'Failed to complete login.' });
        });
    });
  })(req, res, next);
});

app.post('/api/auth/logout', (req, res) => {
  req.logout((logoutError) => {
    if (logoutError) {
      return res.status(500).json({ message: 'Logout failed.' });
    }

    req.session.destroy((destroyError) => {
      if (destroyError) {
        return res.status(500).json({ message: 'Logout failed.' });
      }

      res.clearCookie('connect.sid');
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

app.get('/api/join/:inviteToken', joinLimiter, async (req, res) => {
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

app.post('/api/games/join', requireAuth, joinLimiter, async (req, res) => {
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

  const detail = await getGameDetail(supabase, req.params.gameId);
  if (!detail) {
    return res.status(404).json({ message: 'Game not found.' });
  }
  const { game, memberships, rounds, emailSettings, scoreMap, medalMap } = detail;

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
        description: round.description,
        startsAt: round.startsAt,
        expiresAt: round.expiresAt,
        questions: round.questions.map((question) => question.prompt),
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
  const answers = Array.isArray(req.body.answers) ? req.body.answers.slice(0, 50) : [];
  const validQuestionIds = new Set(questions.map((question) => question.id));

  for (const row of answers) {
    const questionId = row.questionId;
    if (!validQuestionIds.has(questionId)) {
      continue;
    }

    const answer = String(row.answer || '').trim().slice(0, 500);
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

app.put('/api/games/:gameId/rounds/:roundId', requireAuth, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin only.' });
  }

  const parsed = roundSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid round data.' });
  }

  const existing = unwrap(
    await supabase
      .from('Round')
      .select('*')
      .eq('id', req.params.roundId)
      .eq('gameId', req.params.gameId)
      .maybeSingle(),
  );
  if (!existing) {
    return res.status(404).json({ message: 'Round not found.' });
  }
  if (existing.status !== 'DRAFT') {
    return res.status(400).json({ message: 'Only draft rounds can be edited.' });
  }

  const round = unwrap(
    await supabase
      .from('Round')
      .update({
        name: parsed.data.name,
        description: parsed.data.description,
        startsAt: new Date(parsed.data.startsAt).toISOString(),
        expiresAt: new Date(parsed.data.expiresAt).toISOString(),
      })
      .eq('id', req.params.roundId)
      .select()
      .single(),
  );

  unwrap(await supabase.from('Question').delete().eq('roundId', round.id));
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

app.delete('/api/games/:gameId/rounds/:roundId', requireAuth, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin only.' });
  }

  const existing = unwrap(
    await supabase
      .from('Round')
      .select('*')
      .eq('id', req.params.roundId)
      .eq('gameId', req.params.gameId)
      .maybeSingle(),
  );
  if (!existing) {
    return res.status(404).json({ message: 'Round not found.' });
  }
  if (existing.status !== 'DRAFT') {
    return res.status(400).json({ message: 'Only draft rounds can be deleted.' });
  }

  unwrap(await supabase.from('Round').delete().eq('id', req.params.roundId));

  res.json({ ok: true });
});

app.post('/api/games/:gameId/suggestions', requireAuth, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (!role) {
    return res.status(403).json({ message: 'Not part of this game.' });
  }

  const parsed = suggestionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid suggestion.' });
  }

  const suggestion = unwrap(
    await supabase
      .from('QuestionSuggestion')
      .insert({
        gameId: req.params.gameId,
        submittedById: req.user.id,
        prompt: parsed.data.prompt,
        status: 'PENDING',
      })
      .select()
      .single(),
  );

  res.json({ suggestion });
});

app.get('/api/games/:gameId/suggestions', requireAuth, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin only.' });
  }

  const suggestions = await getSuggestionsForGame(supabase, req.params.gameId);
  res.json({ suggestions });
});

app.post('/api/games/:gameId/suggestions/:suggestionId/dismiss', requireAuth, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin only.' });
  }

  const existing = unwrap(
    await supabase
      .from('QuestionSuggestion')
      .select('*')
      .eq('id', req.params.suggestionId)
      .eq('gameId', req.params.gameId)
      .maybeSingle(),
  );
  if (!existing) {
    return res.status(404).json({ message: 'Suggestion not found.' });
  }
  if (existing.status !== 'PENDING') {
    return res.status(400).json({ message: 'Only pending suggestions can be dismissed.' });
  }

  unwrap(
    await supabase.from('QuestionSuggestion').update({ status: 'DISMISSED' }).eq('id', req.params.suggestionId),
  );

  res.json({ ok: true });
});

app.post('/api/games/:gameId/suggestions/:suggestionId/promote', requireAuth, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin only.' });
  }

  const suggestion = unwrap(
    await supabase
      .from('QuestionSuggestion')
      .select('*')
      .eq('id', req.params.suggestionId)
      .eq('gameId', req.params.gameId)
      .maybeSingle(),
  );
  if (!suggestion) {
    return res.status(404).json({ message: 'Suggestion not found.' });
  }
  if (suggestion.status !== 'PENDING') {
    return res.status(400).json({ message: 'Only pending suggestions can be promoted.' });
  }

  const round = unwrap(
    await supabase
      .from('Round')
      .select('*')
      .eq('id', String(req.body.roundId || ''))
      .eq('gameId', req.params.gameId)
      .maybeSingle(),
  );
  if (!round) {
    return res.status(404).json({ message: 'Round not found.' });
  }
  if (round.status !== 'DRAFT') {
    return res.status(400).json({ message: 'Suggestions can only be promoted into draft rounds.' });
  }

  const questions = unwrap(await supabase.from('Question').select('position').eq('roundId', round.id));
  const nextPosition = questions.reduce((max, question) => Math.max(max, question.position), 0) + 1;

  unwrap(
    await supabase.from('Question').insert({
      roundId: round.id,
      prompt: suggestion.prompt,
      position: nextPosition,
    }),
  );

  unwrap(
    await supabase
      .from('QuestionSuggestion')
      .update({ status: 'PROMOTED', promotedRoundId: round.id })
      .eq('id', req.params.suggestionId),
  );

  res.json({ ok: true });
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
      .eq('gameId', req.params.gameId)
      .select()
      .maybeSingle(),
  );

  if (!round) {
    return res.status(404).json({ message: 'Round not found.' });
  }

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

app.post('/api/games/:gameId/email/manual', requireAuth, emailLimiter, async (req, res) => {
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

app.post('/api/games/:gameId/rounds/:roundId/remind', requireAuth, emailLimiter, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin only.' });
  }

  const round = unwrap(
    await supabase
      .from('Round')
      .select('*')
      .eq('id', req.params.roundId)
      .eq('gameId', req.params.gameId)
      .maybeSingle(),
  );

  if (!round) {
    return res.status(404).json({ message: 'Round not found.' });
  }

  if (round.status !== 'ACTIVE') {
    return res.status(400).json({ message: 'Only active rounds can be reminded.' });
  }

  const game = unwrap(await supabase.from('Game').select('*').eq('id', round.gameId).maybeSingle());
  const questions = unwrap(await supabase.from('Question').select('*').eq('roundId', round.id));
  const questionIds = questions.map((question) => question.id);

  const submissions = questionIds.length
    ? unwrap(await supabase.from('Submission').select('*').in('questionId', questionIds))
    : [];
  const submittedPairs = new Set(submissions.map((item) => `${item.userId}:${item.questionId}`));

  const memberships = unwrap(await supabase.from('GameMembership').select('*').eq('gameId', round.gameId));
  const userIds = memberships.map((membership) => membership.userId);
  const users = userIds.length ? unwrap(await supabase.from('User').select('*').in('id', userIds)) : [];

  const pendingUsers = users.filter(
    (user) => !questionIds.every((questionId) => submittedPairs.has(`${user.id}:${questionId}`)),
  );

  for (const user of pendingUsers) {
    const dedupeKey = `manual-reminder:${round.id}:${user.id}:${dayjs().format('YYYY-MM-DD')}`;
    await sendWithDedup(supabase, {
      dedupeKey,
      gameId: round.gameId,
      roundId: round.id,
      recipient: user,
      emailType: 'MANUAL_REMINDER',
      subject: `${game.name}: don't forget ${round.name}`,
      intro: 'Friendly nudge from your game admin — you still have unanswered questions in this round.',
      gameName: game.name,
    });
  }

  res.json({ remindedCount: pendingUsers.length });
});

app.get('/api/games/:gameId/rounds/:roundId/results', requireAuth, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (!role) {
    return res.status(403).json({ message: 'Not part of this game.' });
  }

  await processRounds(supabase);

  const detail = await getRoundResults(supabase, req.params.roundId, req.params.gameId, req.user.id);
  if (!detail) {
    return res.status(404).json({ message: 'Round not found.' });
  }
  const { round, game, scores, questions } = detail;

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
        medalAwarded: score.medalAwarded,
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
