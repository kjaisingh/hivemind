import { supabase, unwrap } from './db.js';

export function buildGameInvite(req, game) {
  const origin = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${origin}/join/${game.inviteToken}`;
}

export async function ensureMembership(gameId, userId, role = 'PLAYER') {
  const existing = unwrap(
    await supabase.from('GameMembership').select('*').eq('gameId', gameId).eq('userId', userId).maybeSingle(),
  );

  if (existing) {
    return existing;
  }

  return unwrap(await supabase.from('GameMembership').insert({ gameId, userId, role }).select().single());
}

export async function getRole(gameId, userId) {
  const membership = unwrap(
    await supabase.from('GameMembership').select('*').eq('gameId', gameId).eq('userId', userId).maybeSingle(),
  );
  return membership?.role;
}

export async function claimPendingInvite(req, userId) {
  const inviteToken = req.session.pendingInviteToken;
  if (!inviteToken) {
    return { inviteToken: null, game: null };
  }

  const game = unwrap(await supabase.from('Game').select('*').eq('inviteToken', inviteToken).maybeSingle());
  if (game) {
    await ensureMembership(game.id, userId);
  }
  req.session.pendingInviteToken = null;

  return { inviteToken, game };
}
