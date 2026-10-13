import { Router } from 'express';
import { isUniqueViolation, supabase, unwrap } from '../db.js';
import { requireAuth } from '../middleware.js';
import { getDashboardData, getGameDetail } from '../repository.js';
import { processRounds } from '../roundScheduler.js';
import { createGameCode, createInviteToken, rankByPoints } from '../utils.js';
import { buildGameInvite, ensureMembership, getRole } from '../helpers.js';
import { joinLimiter } from '../limiters.js';
import { gameSchema, joinGameSchema, validationMessage } from '../validation.js';
import { isEmailConfigured } from '../email.js';

const router = Router();

const GAME_ID_ATTEMPTS = 5;

async function insertGame(details, adminId) {
  for (let attempt = 0; attempt < GAME_ID_ATTEMPTS; attempt += 1) {
    try {
      return unwrap(
        await supabase
          .from('Game')
          .insert({
            ...details,
            code: createGameCode(),
            inviteToken: createInviteToken(),
            adminId,
          })
          .select()
          .single(),
      );
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === GAME_ID_ATTEMPTS - 1) throw error;
    }
  }
  return null;
}

router.get('/dashboard', requireAuth, async (req, res) => {
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
      inviteUrl: buildGameInvite(req, game),
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

router.post('/games', requireAuth, async (req, res) => {
  const parsed = gameSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: validationMessage(parsed, 'Invalid game details.') });
  }

  const game = await insertGame(parsed.data, req.user.id);
  try {
    unwrap(await supabase.from('GameMembership').insert({ gameId: game.id, userId: req.user.id, role: 'ADMIN' }));
    unwrap(await supabase.from('GameEmailSettings').insert({ gameId: game.id }));
  } catch (error) {
    await supabase.from('Game').delete().eq('id', game.id);
    throw error;
  }

  res.json({
    game: {
      ...game,
      inviteUrl: buildGameInvite(req, game),
    },
  });
});

router.post('/games/join', requireAuth, joinLimiter, async (req, res) => {
  const parsed = joinGameSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: validationMessage(parsed) });
  }
  const { code } = parsed.data;
  const game = unwrap(await supabase.from('Game').select('*').eq('code', code).maybeSingle());
  if (!game) {
    return res.status(404).json({ message: 'Game code not found.' });
  }

  await ensureMembership(game.id, req.user.id);
  res.json({ gameId: game.id });
});

router.get('/games/:gameId', requireAuth, async (req, res) => {
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

  const leaderboard = rankByPoints(
    memberships.map((membership) => ({
      userId: membership.userId,
      username: membership.user.username,
      points: scoreMap.get(membership.userId) || 0,
      medals: medalMap.get(membership.userId) || 0,
    })),
  );

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
      inviteUrl: buildGameInvite(req, game),
      role,
      emailConfigured: isEmailConfigured(),
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
        questions: round.questions,
      })),
      emailSettings,
    },
  });
});

export default router;
