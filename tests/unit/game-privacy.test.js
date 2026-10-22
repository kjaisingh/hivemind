import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { mockDatabase } from '../mockDatabase.js';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
delete process.env.RESEND_API_KEY;
delete process.env.SMTP_PASS;
const { supabase } = await import('../../server/db.js');
const { default: gamesRoutes } = await import('../../server/routes/games.js');

test('game details keep unpublished questions and email settings private to hosts', async (t) => {
  const tables = {
    Game: [{ id: 'game-1', name: 'Hive' }],
    GameMembership: [{ gameId: 'game-1', userId: 'user-1', role: 'PLAYER' }],
    User: [{ id: 'user-1', username: 'Player' }],
    Round: [{ id: 'draft-1', gameId: 'game-1', name: 'Secret draft', status: 'DRAFT' }],
    Question: [{ id: 'question-1', roundId: 'draft-1', prompt: 'Unpublished prompt' }],
    GameEmailSettings: [{ gameId: 'game-1', autoRoundOpen: true }],
  };
  t.mock.method(supabase, 'from', mockDatabase(tables).from);
  const app = express();
  app.use((req, _res, next) => { req.user = { id: 'user-1' }; next(); });
  app.use('/api', gamesRoutes);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/games/game-1`;
  const player = await fetch(url).then((response) => response.json());
  assert.deepEqual(player.game.draftRounds, []);
  assert.equal(player.game.emailSettings, null);
  assert.ok(!JSON.stringify(player).includes('Unpublished prompt'));
  tables.GameMembership[0].role = 'ADMIN';
  const admin = await fetch(url).then((response) => response.json());
  assert.equal(admin.game.draftRounds[0].questions[0].prompt, 'Unpublished prompt');
  assert.equal(admin.game.emailSettings.autoRoundOpen, true);
});
