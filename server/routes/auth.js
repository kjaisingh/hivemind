import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { passport } from '../auth.js';
import { isUniqueViolation, supabase, unwrap } from '../db.js';
import { ensureMembership } from '../helpers.js';
import { joinLimiter, loginLimiter, signupLimiter } from '../limiters.js';
import { loginSchema, signUpSchema, validationMessage } from '../validation.js';

const router = Router();

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
    return res.status(400).json({ message: validationMessage(parsed) });
  }

  const { email, username, password } = parsed.data;
  const existingEmail = unwrap(await supabase.from('User').select('id').eq('email', email).maybeSingle());
  if (existingEmail) {
    return res.status(400).json({ message: 'An account with that email already exists.' });
  }
  const existingUsername = unwrap(await supabase.from('User').select('id').eq('username', username).maybeSingle());
  if (existingUsername) {
    return res.status(400).json({ message: 'That username is already taken.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  let user;
  try {
    user = unwrap(await supabase.from('User').insert({ email, username, passwordHash }).select().single());
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({ message: 'Email or username is already in use.' });
    }
    throw error;
  }

  const pendingInviteToken = req.session.pendingInviteToken;
  req.login(user, (error) => {
    if (error) {
      return res.status(500).json({ message: 'Failed to login.' });
    }

    req.session.pendingInviteToken = pendingInviteToken;
    res.json({
      user: { id: user.id, email: user.email, username: user.username },
      pendingInviteToken: pendingInviteToken || null,
    });
  });
});

router.post('/auth/login', loginLimiter, (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: validationMessage(parsed) });
  }
  req.body = parsed.data;

  passport.authenticate('local', (error, user) => {
    if (error) return next(error);
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials.' });
    }

    const pendingInviteToken = req.session.pendingInviteToken;
    req.login(user, (loginError) => {
      if (loginError) {
        return res.status(500).json({ message: 'Login failed.' });
      }

      req.session.pendingInviteToken = pendingInviteToken;
      res.json({
        user: { id: user.id, email: user.email, username: user.username },
        pendingInviteToken: pendingInviteToken || null,
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
  req.session.pendingInviteToken = null;
  return res.json({ requiresAuth: false, gameId: game.id });
});

export default router;
