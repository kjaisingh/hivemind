import { Router } from 'express';
import { supabase, unwrap } from '../db.js';
import { requireAuth } from '../middleware.js';
import { sendEmail } from '../email.js';
import { getRole } from '../helpers.js';
import { emailLimiter } from '../limiters.js';
import { emailSettingsSchema, manualEmailSchema, validationMessage } from '../validation.js';

const router = Router();

router.put('/games/:gameId/email-settings', requireAuth, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin only.' });
  }

  const parsed = emailSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: validationMessage(parsed) });
  }

  const settings = unwrap(
    await supabase
      .from('GameEmailSettings')
      .upsert(
        {
          gameId: req.params.gameId,
          autoRoundOpen: parsed.data.autoRoundOpen,
          autoResultsLive: parsed.data.autoResultsLive,
          expiringHoursCsv: parsed.data.expiringHours.join(','),
        },
        { onConflict: 'gameId' },
      )
      .select()
      .single(),
  );

  res.json({ settings });
});

router.post('/games/:gameId/email/manual', requireAuth, emailLimiter, async (req, res) => {
  const role = await getRole(req.params.gameId, req.user.id);
  if (role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin only.' });
  }

  const parsed = manualEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: validationMessage(parsed) });
  }

  const game = unwrap(await supabase.from('Game').select('*').eq('id', req.params.gameId).maybeSingle());
  if (!game) {
    return res.status(404).json({ message: 'Game not found.' });
  }
  const memberships = unwrap(await supabase.from('GameMembership').select('*').eq('gameId', req.params.gameId));
  const userIds = memberships.map((membership) => membership.userId);
  const users = userIds.length ? unwrap(await supabase.from('User').select('id,email').in('id', userIds)) : [];

  let sentCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  for (const user of users) {
    try {
      const sent = await sendEmail({
        to: user.email,
        subject: parsed.data.subject,
        intro: parsed.data.message,
        gameName: game.name,
      });
      if (sent) sentCount += 1;
      else skippedCount += 1;
    } catch (error) {
      failedCount += 1;
      console.error('[email] Manual delivery failed.', {
        retryable: error.retryable !== false,
        status: error.status || null,
      });
    }
  }

  res.json({ ok: sentCount === users.length, sentCount, skippedCount, failedCount, totalCount: users.length });
});

export default router;
