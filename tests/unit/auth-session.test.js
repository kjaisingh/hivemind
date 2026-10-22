import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import bcrypt from 'bcryptjs';
import { mockDatabase } from '../mockDatabase.js';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SESSION_SECRET = 'test-only-secret';
const { supabase } = await import('../../server/db.js');
const { passport, configurePassport, createSessionMiddleware } = await import('../../server/auth.js');
const { default: authRoutes } = await import('../../server/routes/auth.js');

for (const action of ['login', 'signup']) {
  test(`${action} preserves a pending invite across Passport session regeneration`, async (t) => {
    const user = { id: 'user-1', email: 'player@example.com', username: 'Player', passwordHash: bcrypt.hashSync('test-password', 4) };
    const tables = { User: action === 'login' ? [user] : [], Game: [{ id: 'game-1', name: 'Hive', inviteToken: 'invite-token' }] };
    t.mock.method(supabase, 'from', mockDatabase(tables).from);
    configurePassport(supabase);
    const app = express();
    app.use(express.json());
    app.use(createSessionMiddleware());
    app.use(passport.initialize());
    app.use(passport.session());
    app.use('/api', authRoutes);
    const server = app.listen(0, '127.0.0.1');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const invite = await fetch(`${origin}/api/join/invite-token`);
    const cookie = invite.headers.get('set-cookie').split(';')[0];
    const response = await fetch(`${origin}/api/auth/${action}`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, username: user.username, password: 'test-password' }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.pendingInviteToken, 'invite-token');
    const authenticatedCookie = response.headers.get('set-cookie').split(';')[0];
    assert.notEqual(authenticatedCookie, cookie);
    const joined = await fetch(`${origin}/api/join/invite-token`, { headers: { Cookie: authenticatedCookie } });
    assert.equal(joined.status, 200);
    assert.deepEqual(await joined.json(), { requiresAuth: false, gameId: 'game-1' });
    assert.equal(tables.GameMembership.length, 1);
    assert.equal(tables.GameMembership[0].gameId, 'game-1');
    assert.equal(tables.GameMembership[0].userId, body.user.id);
  });
}
