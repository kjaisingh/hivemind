import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { passport } from '../auth.js';
import { supabase, unwrap } from '../db.js';
import { claimPendingInvite, ensureMembership } from '../helpers.js';
import { joinLimiter, loginLimiter, signupLimiter } from '../limiters.js';

const router = Router();

const signUpSchema = z.object({
  email: z.string().email('Enter a valid email address.').toLowerCase(),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters.')
    .max(24, 'Username must be 24 characters or fewer.')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores.'),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(72, 'Password must be 72 characters or fewer.'),
});

router.get('/auth/me', (req, res) => {
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

router.post('/auth/signup', signupLimiter, async (req, res) => {
  const parsed = signUpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0].message });
  }

  const { email, username, password } = parsed.data;
  const existingEmail = unwrap(await supabase.from('User').select('*').eq('email', email).maybeSingle());
  if (existingEmail) {
    return res.status(400).json({ message: 'An account with that email already exists.' });
  }
  const existingUsername = unwrap(await supabase.from('User').select('*').eq('username', username).maybeSingle());
  if (existingUsername) {
    return res.status(400).json({ message: 'That username is already taken.' });
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

router.post('/auth/login', loginLimiter, (req, res, next) => {
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

router.post('/auth/logout', (req, res) => {
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

router.get('/join/:inviteToken', joinLimiter, async (req, res) => {
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

export default router;
