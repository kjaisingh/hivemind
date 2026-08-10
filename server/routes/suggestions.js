import { Router } from 'express';
import { z } from 'zod';
import { supabase, unwrap } from '../db.js';
import { requireAuth } from '../middleware.js';
import { getSuggestionsForGame } from '../repository.js';
import { getRole } from '../helpers.js';

const router = Router();

const suggestionSchema = z.object({
  prompt: z.string().min(1).max(240),
});

router.post('/games/:gameId/suggestions', requireAuth, async (req, res) => {
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

router.get('/games/:gameId/suggestions', requireAuth, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin only.' });
  }

  const suggestions = await getSuggestionsForGame(supabase, req.params.gameId);
  res.json({ suggestions });
});

router.post('/games/:gameId/suggestions/:suggestionId/dismiss', requireAuth, async (req, res) => {
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

router.post('/games/:gameId/suggestions/:suggestionId/promote', requireAuth, async (req, res) => {
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

export default router;
