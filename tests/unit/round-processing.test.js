import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { mockDatabase } from '../mockDatabase.js';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.RESEND_API_KEY = 'test-key';
process.env.SMTP_FROM = 'hive@example.com';

const { supabase, readAll, readByIds } = await import('../../server/db.js');
const { scoreRound } = await import('../../server/scoring.js');
const { getGameDetail, getRoundResults } = await import('../../server/repository.js');
const { processRounds, processNotifications } = await import('../../server/roundScheduler.js');
const { default: roundsRoutes } = await import('../../server/routes/rounds.js');

function gameTables(playerCount = 1, questionCount = 1) {
  const users = Array.from({ length: playerCount }, (_, i) => ({ id: `user-${i}`, username: `Player${i}`, email: `player${i}@example.com` }));
  const questions = Array.from({ length: questionCount }, (_, i) => ({ id: `question-${i}`, roundId: 'round-1', position: i + 1 }));
  return {
    User: users,
    Game: [{ id: 'game-1', name: 'Hive' }],
    GameMembership: users.map((user, i) => ({ id: `member-${i}`, userId: user.id, gameId: 'game-1', role: 'ADMIN' })),
    GameEmailSettings: [{ id: 'settings', gameId: 'game-1', autoRoundOpen: true, autoResultsLive: true, expiringHoursCsv: '' }],
    Round: [{ id: 'round-1', gameId: 'game-1', name: 'Round', status: 'ACTIVE', startsAt: new Date(Date.now() - 3600000).toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString() }],
    Question: questions,
    Submission: questions.flatMap((question) => users.map((user) => ({ id: `${question.id}:${user.id}`, questionId: question.id, userId: user.id, rawAnswer: user.username }))),
  };
}

test('scoring and results include every answer beyond the database row limit', async () => {
  const tables = gameTables(75, 20);
  const db = mockDatabase(tables);
  await scoreRound(db, 'round-1');
  assert.equal(tables.RoundScore.length, 75);
  assert.ok(tables.RoundScore.every((score) => score.totalScore === 20));
  assert.equal(tables.QuestionAnswerStat.length, 1500);
  const results = await getRoundResults(db, 'round-1', 'game-1', 'user-0');
  assert.ok(results.questions.every((question) => question.answerStats.length === 75));
  assert.ok(results.questions.every((question) => question.submissions[0].rawAnswer === 'Player0'));
});

test('season totals include all rounds beyond the database row limit', async () => {
  const tables = gameTables(30);
  tables.Round = Array.from({ length: 50 }, (_, i) => ({ id: `round-${i}`, gameId: 'game-1', status: 'CLOSED' }));
  tables.RoundScore = tables.Round.flatMap((round) => tables.User.map((user) => ({ id: `${round.id}:${user.id}`, roundId: round.id, userId: user.id, totalScore: 2, medalAwarded: true })));
  const detail = await getGameDetail(mockDatabase(tables), 'game-1');
  assert.ok(tables.User.every((user) => detail.scoreMap.get(user.id) === 100));
  assert.ok(tables.User.every((user) => detail.medalMap.get(user.id) === 50));
});

test('a failed later page rejects instead of returning partial results', async () => {
  const query = {
    order() { return this; },
    async range(offset) {
      return offset === 0 ? { data: Array(500).fill({ id: 'row' }), error: null } : { data: null, error: { message: 'Unavailable' } };
    },
  };
  await assert.rejects(readAll(query), /Unavailable/);
});

test('large ID filters are batched and repeated IDs cannot duplicate rows', async () => {
  const ids = Array.from({ length: 251 }, (_, i) => `id-${i}`);
  const db = mockDatabase({ User: ids.map((id) => ({ id })) });
  const sizes = [];
  const rows = await readByIds([...ids, ...ids], (batch) => {
    sizes.push(batch.length);
    return db.from('User').select('id').in('id', batch);
  });
  assert.deepEqual(sizes, [100, 100, 51]);
  assert.equal(rows.length, 251);
});

test('round closure never waits for email and failed notifications retry without duplicate delivery', async (t) => {
  t.mock.method(console, 'error', () => {});
  const tables = gameTables();
  const db = mockDatabase(tables);
  let attempts = 0;
  const keys = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    attempts += 1;
    keys.push(options.headers['Idempotency-Key']);
    return { ok: attempts > 1, status: 503 };
  });
  await processRounds(db);
  assert.equal(tables.Round[0].status, 'CLOSED');
  assert.equal(attempts, 0);
  await processNotifications(db);
  assert.equal(attempts, 1);
  assert.equal(tables.EmailDeliveryLog.length, 0);
  await Promise.all([processNotifications(db), processNotifications(db)]);
  assert.equal(attempts, 2);
  await processNotifications(db);
  assert.equal(attempts, 2);
  assert.deepEqual(keys, ['results-live:round-1:user-0', 'results-live:round-1:user-0']);
});

test('active-round announcements retry and old closed rounds receive no backfill', async (t) => {
  t.mock.method(console, 'error', () => {});
  const tables = gameTables();
  tables.Round[0].expiresAt = new Date(Date.now() + 3600000).toISOString();
  tables.Round.push({ id: 'old', gameId: 'game-1', status: 'CLOSED', expiresAt: new Date(Date.now() - 2 * 86400000).toISOString() });
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => ({ ok: ++attempts > 1, status: 429 }));
  const db = mockDatabase(tables);
  await processNotifications(db);
  await processNotifications(db);
  await processNotifications(db);
  assert.equal(attempts, 2);
  assert.equal(tables.EmailDeliveryLog[0].emailType, 'ROUND_OPEN');
});

test('publish returns before delivery and progress counts every completed player', async (t) => {
  const tables = gameTables(75, 20);
  tables.Round[0].status = 'DRAFT';
  tables.Round[0].expiresAt = new Date(Date.now() + 3600000).toISOString();
  const db = mockDatabase(tables);
  t.mock.method(supabase, 'from', (table) => {
    assert.notEqual(table, 'EmailDeliveryLog', 'publish must not wait for email delivery');
    return db.from(table);
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'user-0' }; next(); });
  app.use('/api', roundsRoutes);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/games/game-1/rounds/round-1`;
  const published = await fetch(`${url}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(published.status, 200);
  assert.equal(tables.Round[0].status, 'ACTIVE');
  const progress = await fetch(`${url}/progress`).then((response) => response.json());
  assert.deepEqual(progress, { submittedCount: 75, totalCount: 75 });
});
