import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from './db.js';
import { createSessionMiddleware, configurePassport, passport } from './auth.js';
import { requireAuth } from './middleware.js';
import { createGameCode, createInviteToken, normalizeAnswer } from './utils.js';
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
configurePassport(prisma);
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
  const existing = await prisma.gameMembership.findUnique({
    where: {
      gameId_userId: { gameId, userId },
    },
  });

  if (existing) {
    return existing;
  }

  return prisma.gameMembership.create({
    data: { gameId, userId, role },
  });
}

async function getRole(gameId, userId) {
  const membership = await prisma.gameMembership.findUnique({
    where: { gameId_userId: { gameId, userId } },
  });
  return membership?.role;
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
  const existingEmail = await prisma.user.findUnique({ where: { email } });
  const existingUsername = await prisma.user.findUnique({ where: { username } });
  if (existingEmail || existingUsername) {
    return res.status(400).json({ message: 'Email or username already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      username,
      passwordHash,
    },
  });

  req.login(user, async (error) => {
    if (error) {
      return res.status(500).json({ message: 'Failed to login.' });
    }

    const inviteToken = req.session.pendingInviteToken;
    if (inviteToken) {
      const game = await prisma.game.findUnique({ where: { inviteToken } });
      if (game) {
        await ensureMembership(game.id, user.id);
      }
      req.session.pendingInviteToken = null;
    }

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

      const inviteToken = req.session.pendingInviteToken;
      if (inviteToken) {
        const game = await prisma.game.findUnique({ where: { inviteToken } });
        if (game) {
          await ensureMembership(game.id, user.id);
        }
        req.session.pendingInviteToken = null;
      }

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
  const inviteToken = req.session.pendingInviteToken;
  if (inviteToken) {
    const game = await prisma.game.findUnique({ where: { inviteToken } });
    if (game) {
      await ensureMembership(game.id, req.user.id);
      req.session.pendingInviteToken = null;
      return res.redirect(`${clientUrl}/games/${game.id}`);
    }
  }

  return res.redirect(`${clientUrl}/dashboard`);
});

app.get('/api/join/:inviteToken', async (req, res) => {
  const game = await prisma.game.findUnique({ where: { inviteToken: req.params.inviteToken } });
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
  await processRounds(prisma);

  const memberships = await prisma.gameMembership.findMany({
    where: { userId: req.user.id },
    include: {
      game: {
        include: {
          rounds: {
            orderBy: { expiresAt: 'desc' },
            include: {
              questions: true,
            },
          },
        },
      },
    },
  });

  const gameIds = memberships.map((membership) => membership.gameId);
  const submissions = await prisma.submission.findMany({
    where: {
      userId: req.user.id,
      question: {
        round: {
          gameId: {
            in: gameIds,
          },
        },
      },
    },
    include: {
      question: {
        include: {
          round: true,
        },
      },
    },
  });

  const answersByRound = submissions.reduce((map, submission) => {
    const roundId = submission.question.roundId;
    map[roundId] = (map[roundId] || 0) + 1;
    return map;
  }, {});

  const games = memberships.map((membership) => {
    const activeRound = membership.game.rounds.find((round) => round.status === 'ACTIVE');
    const recentClosed = membership.game.rounds.filter((round) => round.status === 'CLOSED').slice(0, 3);

    const pending = activeRound
      ? (answersByRound[activeRound.id] || 0) < activeRound.questions.length
      : false;

    return {
      id: membership.game.id,
      role: membership.role,
      name: membership.game.name,
      description: membership.game.description,
      code: membership.game.code,
      inviteUrl: buildGameInvite(membership.game),
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

  const game = await prisma.game.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      code,
      inviteToken,
      adminId: req.user.id,
      memberships: {
        create: {
          userId: req.user.id,
          role: 'ADMIN',
        },
      },
      emailSettings: {
        create: {},
      },
    },
  });

  res.json({
    game: {
      ...game,
      inviteUrl: buildGameInvite(game),
    },
  });
});

app.post('/api/games/join', requireAuth, async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const game = await prisma.game.findUnique({ where: { code } });
  if (!game) {
    return res.status(404).json({ message: 'Game code not found.' });
  }

  await ensureMembership(game.id, req.user.id);
  res.json({ gameId: game.id });
});

app.get('/api/games/:gameId', requireAuth, async (req, res) => {
  await processRounds(prisma);
  const role = await getRole(req.params.gameId, req.user.id);
  if (!role) {
    return res.status(403).json({ message: 'Not part of this game.' });
  }

  const game = await prisma.game.findUnique({
    where: { id: req.params.gameId },
    include: {
      memberships: { include: { user: true } },
      rounds: {
        orderBy: { createdAt: 'desc' },
        include: {
          questions: {
            orderBy: { position: 'asc' },
          },
        },
      },
      emailSettings: true,
    },
  });

  const activeRound = game.rounds.find((round) => round.status === 'ACTIVE') || null;
  const pastRounds = game.rounds.filter((round) => round.status === 'CLOSED');
  const draftRounds = game.rounds.filter((round) => round.status === 'DRAFT');

  const seasonScores = await prisma.roundScore.groupBy({
    by: ['userId'],
    where: {
      round: {
        gameId: game.id,
      },
    },
    _sum: {
      totalScore: true,
    },
  });

  const medalCounts = await prisma.roundScore.groupBy({
    by: ['userId'],
    where: {
      round: {
        gameId: game.id,
      },
      medalAwarded: true,
    },
    _count: {
      _all: true,
    },
  });

  const scoreMap = new Map(seasonScores.map((row) => [row.userId, row._sum.totalScore || 0]));
  const medalMap = new Map(medalCounts.map((row) => [row.userId, row._count._all]));

  const leaderboard = game.memberships
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
    answers = await prisma.submission.findMany({
      where: {
        userId: req.user.id,
        question: {
          roundId: activeRound.id,
        },
      },
    });
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
      emailSettings: game.emailSettings,
    },
  });
});

app.post('/api/games/:gameId/active-round/save', requireAuth, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (!role) {
    return res.status(403).json({ message: 'Not part of this game.' });
  }

  const round = await prisma.round.findFirst({
    where: {
      gameId: req.params.gameId,
      status: 'ACTIVE',
    },
    include: {
      questions: true,
    },
  });

  if (!round) {
    return res.status(400).json({ message: 'No active round.' });
  }

  if (new Date(round.expiresAt) <= new Date()) {
    await processRounds(prisma);
    return res.status(400).json({ message: 'Round is closed.' });
  }

  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  const validQuestionIds = new Set(round.questions.map((question) => question.id));

  for (const row of answers) {
    const questionId = row.questionId;
    if (!validQuestionIds.has(questionId)) {
      continue;
    }

    const answer = String(row.answer || '').trim();
    if (!answer) {
      continue;
    }

    await prisma.submission.upsert({
      where: {
        questionId_userId: {
          questionId,
          userId: req.user.id,
        },
      },
      update: {
        rawAnswer: answer,
        normalizedAnswer: normalizeAnswer(answer),
      },
      create: {
        questionId,
        userId: req.user.id,
        rawAnswer: answer,
        normalizedAnswer: normalizeAnswer(answer),
      },
    });
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

  const round = await prisma.round.create({
    data: {
      gameId: req.params.gameId,
      name: parsed.data.name,
      description: parsed.data.description,
      startsAt: new Date(parsed.data.startsAt),
      expiresAt: new Date(parsed.data.expiresAt),
      status: 'DRAFT',
      questions: {
        create: parsed.data.questions.map((question, index) => ({
          prompt: question,
          position: index + 1,
        })),
      },
    },
  });

  res.json({ roundId: round.id });
});

app.post('/api/games/:gameId/rounds/:roundId/publish', requireAuth, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin only.' });
  }

  const announcement = String(req.body.announcement || '').trim();

  const round = await prisma.round.update({
    where: { id: req.params.roundId },
    data: {
      status: 'ACTIVE',
      publishedAt: new Date(),
      announcementEmail: announcement,
    },
    include: {
      game: {
        include: {
          memberships: { include: { user: true } },
          emailSettings: true,
        },
      },
    },
  });

  if (round.game.emailSettings?.autoRoundOpen) {
    for (const membership of round.game.memberships) {
      await sendEmail({
        to: membership.user.email,
        subject: `${round.game.name}: ${round.name} is live`,
        intro: announcement || 'A fresh round just opened. Time to read minds and earn points.',
        gameName: round.game.name,
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

  const settings = await prisma.gameEmailSettings.upsert({
    where: { gameId: req.params.gameId },
    update: {
      autoRoundOpen: Boolean(req.body.autoRoundOpen),
      autoResultsLive: Boolean(req.body.autoResultsLive),
      expiringHoursCsv: expiringHours.join(','),
    },
    create: {
      gameId: req.params.gameId,
      autoRoundOpen: Boolean(req.body.autoRoundOpen),
      autoResultsLive: Boolean(req.body.autoResultsLive),
      expiringHoursCsv: expiringHours.join(','),
    },
  });

  res.json({ settings });
});

app.post('/api/games/:gameId/email/manual', requireAuth, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin only.' });
  }

  const subject = String(req.body.subject || '').trim();
  const message = String(req.body.message || '').trim();

  const game = await prisma.game.findUnique({
    where: { id: req.params.gameId },
    include: { memberships: { include: { user: true } } },
  });

  for (const membership of game.memberships) {
    await sendEmail({
      to: membership.user.email,
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

  await processRounds(prisma);

  const round = await prisma.round.findUnique({
    where: { id: req.params.roundId },
    include: {
      game: true,
      scores: {
        include: {
          user: true,
        },
        orderBy: [{ rank: 'asc' }, { totalScore: 'desc' }],
      },
      questions: {
        orderBy: { position: 'asc' },
        include: {
          answerStats: {
            orderBy: { count: 'desc' },
          },
          submissions: {
            where: {
              userId: req.user.id,
            },
          },
        },
      },
    },
  });

  const ownScore = round.scores.find((score) => score.userId === req.user.id) || {
    totalScore: 0,
    rank: round.scores.length + 1,
  };

  res.json({
    round: {
      id: round.id,
      name: round.name,
      gameName: round.game.name,
      ownScore,
      leaderboard: round.scores.map((score) => ({
        userId: score.userId,
        username: score.user.username,
        totalScore: score.totalScore,
        rank: score.rank,
      })),
      questions: round.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        yourAnswer: question.submissions[0]?.rawAnswer || '',
        stats: question.answerStats,
      })),
    },
  });
});

app.get('/join/:inviteToken', async (req, res) => {
  const game = await prisma.game.findUnique({ where: { inviteToken: req.params.inviteToken } });
  if (!game) {
    return res.redirect(`${clientUrl}/auth?invite=invalid`);
  }

  return res.redirect(`${clientUrl}/join/${req.params.inviteToken}`);
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
  await processRounds(prisma);
  startRoundScheduler(prisma);
  console.log(`Hivemind running on http://localhost:${port}`);
});
