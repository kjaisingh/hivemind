import { Router } from 'express';
import { supabase, unwrap } from '../db.js';
import { requireAuth } from '../middleware.js';
import { sendEmail } from '../email.js';
import { getRole } from '../helpers.js';
import { emailLimiter } from '../limiters.js';

const router = Router();

router.put('/games/:gameId/email-settings', requireAuth, async (req, res) => {
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

router.post('/games/:gameId/email/manual', requireAuth, emailLimiter, async (req, res) => {
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

  let sentCount = 0;
  for (const user of users) {
    try {
      await sendEmail({
        to: user.email,
        subject,
        intro: message,
        gameName: game.name,
      });
      sentCount += 1;
    } catch (error) {
      console.error('[email]', 'manual', user.email, error);
    }
  }

  res.json({ ok: true, sentCount, totalCount: users.length });
});

export default router;
