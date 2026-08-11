import { Router } from 'express';
import dayjs from 'dayjs';
import { z } from 'zod';
import { supabase, unwrap } from '../db.js';
import { requireAuth } from '../middleware.js';
import { getRoundResults } from '../repository.js';
import { processRounds, sendWithDedup } from '../roundScheduler.js';
import { normalizeAnswer } from '../utils.js';
import { sendEmail } from '../email.js';
import { getRole } from '../helpers.js';
import { emailLimiter } from '../limiters.js';

const router = Router();

const questionSchema = z
  .object({
    prompt: z.string().min(1).max(240),
    type: z.enum(['TEXT', 'MULTIPLE_CHOICE']).default('TEXT'),
    choices: z.array(z.string().min(1).max(120)).max(8).optional(),
  })
  .refine((question) => question.type !== 'MULTIPLE_CHOICE' || (question.choices || []).length >= 2, {
    message: 'Multiple choice questions need at least 2 choices.',
    path: ['choices'],
  });

const roundSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().max(240).optional(),
    startsAt: z.string().min(1),
    expiresAt: z.string().min(1),
    questions: z.array(questionSchema).min(1).max(20),
  })
  .refine((data) => !Number.isNaN(new Date(data.startsAt).getTime()), {
    message: 'Invalid start date.',
    path: ['startsAt'],
  })
  .refine((data) => !Number.isNaN(new Date(data.expiresAt).getTime()), {
    message: 'Invalid expiry date.',
    path: ['expiresAt'],
  });

router.post('/games/:gameId/active-round/save', requireAuth, async (req, res) => {
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
  const questionsById = new Map(questions.map((question) => [question.id, question]));

  for (const row of answers) {
    const questionId = row.questionId;
    const question = questionsById.get(questionId);
    if (!question) {
      continue;
    }

    const answer = String(row.answer || '').trim().slice(0, 500);
    if (!answer) {
      continue;
    }

    if (question.type === 'MULTIPLE_CHOICE' && !(question.choices || []).includes(answer)) {
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

router.post('/games/:gameId/rounds', requireAuth, async (req, res) => {
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
        prompt: question.prompt,
        type: question.type,
        choices: question.type === 'MULTIPLE_CHOICE' ? question.choices : null,
        position: index + 1,
      })),
    ),
  );

  res.json({ roundId: round.id });
});

router.put('/games/:gameId/rounds/:roundId', requireAuth, async (req, res) => {
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
        prompt: question.prompt,
        type: question.type,
        choices: question.type === 'MULTIPLE_CHOICE' ? question.choices : null,
        position: index + 1,
      })),
    ),
  );

  res.json({ roundId: round.id });
});

router.delete('/games/:gameId/rounds/:roundId', requireAuth, async (req, res) => {
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

router.post('/games/:gameId/rounds/:roundId/publish', requireAuth, async (req, res) => {
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
      try {
        await sendEmail({
          to: user.email,
          subject: `${game.name}: ${round.name} is live`,
          intro: announcement || 'A fresh round just opened. Time to read minds and earn points.',
          gameName: game.name,
        });
      } catch (error) {
        console.error('[email]', 'round-open', user.email, error);
      }
    }
  }

  res.json({ ok: true });
});

router.post('/games/:gameId/rounds/:roundId/remind', requireAuth, emailLimiter, async (req, res) => {
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
      intro: 'Friendly nudge from your game admin. You still have unanswered questions in this round.',
      gameName: game.name,
    });
  }

  res.json({ remindedCount: pendingUsers.length });
});

router.get('/games/:gameId/rounds/:roundId/results', requireAuth, async (req, res) => {
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
        yourNormalizedAnswer: normalizeAnswer(question.submissions[0]?.rawAnswer || ''),
        stats: question.answerStats,
      })),
    },
  });
});

export default router;
