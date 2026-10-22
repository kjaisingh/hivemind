import { Router } from 'express';
import { supabase, unwrap } from '../db.js';
import { requireAuth } from '../middleware.js';
import { getSuggestionsForGame } from '../repository.js';
import { getRole } from '../helpers.js';
import { promotionSchema, suggestionSchema, validationMessage } from '../validation.js';

const router = Router();

router.post('/games/:gameId/suggestions', requireAuth, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (!role) {
    return res.status(403).json({ message: 'Not part of this game.' });
  }

  const parsed = suggestionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: validationMessage(parsed, 'Invalid suggestion.') });
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

  const dismissed = unwrap(
    await supabase
      .from('QuestionSuggestion')
      .update({ status: 'DISMISSED' })
      .eq('id', req.params.suggestionId)
      .eq('status', 'PENDING')
      .select('id')
      .maybeSingle(),
  );
  if (!dismissed) {
    return res.status(409).json({ message: 'Suggestion was already reviewed.' });
  }

  res.json({ ok: true });
});

router.post('/games/:gameId/suggestions/:suggestionId/promote', requireAuth, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin only.' });
  }

  const parsed = promotionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: validationMessage(parsed) });
  unwrap(await supabase.rpc('promote_suggestion', {
    p_game_id: req.params.gameId,
    p_round_id: parsed.data.roundId,
    p_suggestion_id: req.params.suggestionId,
  }));

  res.json({ ok: true });
});

export default router;
