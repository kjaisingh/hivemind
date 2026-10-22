import { Router } from 'express';
import dayjs from 'dayjs';
import { supabase, readAll, readByIds, unwrap } from '../db.js';
import { requireAuth } from '../middleware.js';
import { getRoundResults } from '../repository.js';
import { processRounds, sendWithDedup } from '../roundScheduler.js';
import { normalizeAnswer } from '../utils.js';
import { getRole } from '../helpers.js';
import { emailLimiter } from '../limiters.js';
import { answersSchema, publishRoundSchema, roundSchema, validationMessage } from '../validation.js';

const router = Router();

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

  const questions = await readAll(supabase.from('Question').select('*').eq('roundId', round.id));
  const parsed = answersSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: validationMessage(parsed) });
  }

  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const savedRows = [];
  const clearedQuestionIds = [];

  for (const row of parsed.data.answers) {
    const questionId = row.questionId;
    const question = questionsById.get(questionId);
    if (!question) {
      return res.status(400).json({ message: 'Answer contains a question outside the active round.' });
    }

    const answer = row.answer;
    if (!answer) {
      clearedQuestionIds.push(questionId);
      continue;
    }

    if (question.type === 'MULTIPLE_CHOICE' && !(question.choices || []).includes(answer)) {
      return res.status(400).json({ message: 'Select one of the available choices.' });
    }

    savedRows.push({
      questionId,
      userId: req.user.id,
      rawAnswer: answer,
      normalizedAnswer: normalizeAnswer(answer),
    });
  }

  unwrap(await supabase.rpc('save_round_answers', {
    p_round_id: round.id,
    p_user_id: req.user.id,
    p_answers: [...savedRows, ...clearedQuestionIds.map((questionId) => ({ questionId, rawAnswer: '', normalizedAnswer: '' }))],
  }));

  res.json({ ok: true, savedCount: savedRows.length, deletedCount: clearedQuestionIds.length });
});

async function saveDraft(req, res) {
  const role = await getRole(req.params.gameId, req.user.id);
  if (role !== 'ADMIN') return res.status(403).json({ message: 'Admin only.' });
  const parsed = roundSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: validationMessage(parsed, 'Invalid round data.') });
  const { questions, ...details } = parsed.data;
  const roundId = unwrap(await supabase.rpc('save_draft_round', {
    p_game_id: req.params.gameId,
    p_round_id: req.params.roundId || null,
    p_details: details,
    p_questions: questions,
  }));
  res.json({ roundId });
}

router.post('/games/:gameId/rounds', requireAuth, saveDraft);
router.put('/games/:gameId/rounds/:roundId', requireAuth, saveDraft);

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
    return res.status(409).json({ message: 'Only draft rounds can be deleted.' });
  }

  const deleted = unwrap(
    await supabase
      .from('Round')
      .delete()
      .eq('id', req.params.roundId)
      .eq('gameId', req.params.gameId)
      .eq('status', 'DRAFT')
      .select('id')
      .maybeSingle(),
  );
  if (!deleted) {
    return res.status(409).json({ message: 'Round is no longer a draft.' });
  }

  res.json({ ok: true });
});

router.post('/games/:gameId/rounds/:roundId/publish', requireAuth, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin only.' });
  }

  const parsed = publishRoundSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: validationMessage(parsed) });
  }

  unwrap(await supabase.rpc('publish_round', {
    p_game_id: req.params.gameId,
    p_round_id: req.params.roundId,
    p_announcement: parsed.data.announcement,
  }));

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

  if (round.status !== 'ACTIVE' || new Date(round.expiresAt) <= new Date()) {
    return res.status(400).json({ message: 'Only active rounds can be reminded.' });
  }

  const game = unwrap(await supabase.from('Game').select('*').eq('id', round.gameId).maybeSingle());
  const questions = await readAll(supabase.from('Question').select('*').eq('roundId', round.id));
  const questionIds = questions.map((question) => question.id);

  const submissions = questionIds.length
    ? await readByIds(questionIds, (ids) => supabase.from('Submission').select('*').in('questionId', ids))
    : [];
  const submittedPairs = new Set(submissions.map((item) => `${item.userId}:${item.questionId}`));

  const memberships = await readAll(supabase.from('GameMembership').select('*').eq('gameId', round.gameId));
  const userIds = memberships.map((membership) => membership.userId);
  const users = userIds.length ? await readByIds(userIds, (ids) => supabase.from('User').select('id,email').in('id', ids)) : [];

  const pendingUsers = users.filter(
    (user) => !questionIds.every((questionId) => submittedPairs.has(`${user.id}:${questionId}`)),
  );

  let remindedCount = 0;
  for (const user of pendingUsers) {
    const dedupeKey = `manual-reminder:${round.id}:${user.id}:${dayjs().format('YYYY-MM-DD')}`;
    const sent = await sendWithDedup(supabase, {
      dedupeKey,
      gameId: round.gameId,
      roundId: round.id,
      recipient: user,
      emailType: 'MANUAL_REMINDER',
      subject: `${game.name}: don't forget ${round.name}`,
      intro: 'Friendly nudge from your game admin. You still have unanswered questions in this round.',
      gameName: game.name,
    });
    if (sent) remindedCount += 1;
  }

  res.json({ remindedCount, pendingCount: pendingUsers.length });
});

router.get('/games/:gameId/rounds/:roundId/progress', requireAuth, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (!role) {
    return res.status(403).json({ message: 'Not part of this game.' });
  }

  const round = unwrap(
    await supabase
      .from('Round')
      .select('*')
      .eq('id', req.params.roundId)
      .eq('gameId', req.params.gameId)
      .maybeSingle(),
  );
  if (!round || round.status !== 'ACTIVE') {
    return res.status(404).json({ message: 'Active round not found.' });
  }

  const [questions, memberships] = await Promise.all([
    readAll(supabase.from('Question').select('id').eq('roundId', round.id)),
    readAll(supabase.from('GameMembership').select('userId').eq('gameId', req.params.gameId)),
  ]);
  const questionIds = questions.map((question) => question.id);
  const submissions = questionIds.length
    ? await readByIds(questionIds, (ids) => supabase.from('Submission').select('questionId,userId').in('questionId', ids))
    : [];
  const countsByUser = new Map();
  for (const submission of submissions) {
    countsByUser.set(submission.userId, (countsByUser.get(submission.userId) || 0) + 1);
  }

  const submittedCount = memberships.filter(
    (membership) => questionIds.length > 0 && countsByUser.get(membership.userId) === questionIds.length,
  ).length;
  res.json({ submittedCount, totalCount: memberships.length });
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
  if (round.status !== 'CLOSED') {
    return res.status(409).json({ message: 'Results are available after the round closes.' });
  }

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
        yourNormalizedAnswer: question.answerStats.some((stat) => stat.normalizedAnswer === question.submissions[0]?.rawAnswer)
          ? question.submissions[0].rawAnswer
          : normalizeAnswer(question.submissions[0]?.rawAnswer || ''),
        stats: question.answerStats,
      })),
    },
  });
});

export default router;
