import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import test, { before, after } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
before(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(await readFile(new URL('../../supabase/schema.sql', import.meta.url), 'utf8'));
  const functions = await readFile(new URL('../../supabase/functions.sql', import.meta.url), 'utf8');
  await db.exec(functions);
  await db.exec(functions);
});
after(() => db.close());

async function fixture(questionCount = 1) {
  const userId = randomUUID();
  const gameId = randomUUID();
  await db.query('insert into "User" (id,email,username) values ($1,$2,$3)', [userId, `${userId}@example.com`, userId]);
  await db.query('insert into "Game" (id,name,description,code,"inviteToken","adminId") values ($1::uuid,\'Hive\',\'Test\',$1::text,$1::text,$2)', [gameId, userId]);
  await db.query('insert into "GameMembership" ("gameId","userId",role) values ($1,$2,\'ADMIN\')', [gameId, userId]);
  const details = { name: 'Draft', description: '', startsAt: new Date(Date.now() - 3600000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() };
  const questions = Array.from({ length: questionCount }, (_, i) => ({ prompt: `Question ${i}`, type: 'TEXT' }));
  const { rows: [{ roundId }] } = await db.query('select save_draft_round($1,null,$2,$3) as "roundId"', [gameId, JSON.stringify(details), JSON.stringify(questions)]);
  const { rows } = await db.query('select id from "Question" where "roundId"=$1 order by position', [roundId]);
  return { userId, gameId, roundId, details, questions: rows };
}

async function publish({ gameId, roundId }) {
  await db.query('select publish_round($1,$2,\'\')', [gameId, roundId]);
}
async function expire(roundId) {
  await db.query('update "Round" set "expiresAt"=now()-interval \'1 second\' where id=$1', [roundId]);
}
async function answer(f, rawAnswer, normalizedAnswer = rawAnswer, questionId = f.questions[0].id) {
  return db.query('select save_round_answers($1,$2,$3)', [f.roundId, f.userId, JSON.stringify([{ questionId, rawAnswer, normalizedAnswer }])]);
}

test('draft replacement rolls back metadata and questions when an insert fails', async () => {
  const f = await fixture();
  await assert.rejects(db.query('select save_draft_round($1,$2,$3,$4)', [f.gameId, f.roundId, JSON.stringify({ ...f.details, name: 'Changed' }), JSON.stringify([{ type: 'TEXT' }])]), /null value/);
  const { rows: [round] } = await db.query('select name from "Round" where id=$1', [f.roundId]);
  const { rows: questions } = await db.query('select id from "Question" where "roundId"=$1', [f.roundId]);
  assert.equal(round.name, 'Draft');
  assert.deepEqual(questions, f.questions);
  await db.query('select save_draft_round($1,$2,$3,$4)', [f.gameId, f.roundId, JSON.stringify({ ...f.details, name: 'Updated' }), JSON.stringify([{ prompt: 'Replacement' }])]);
  assert.equal((await db.query('select prompt from "Question" where "roundId"=$1', [f.roundId])).rows[0].prompt, 'Replacement');
});

test('failed draft creation leaves no empty round', async () => {
  const f = await fixture();
  const beforeCount = (await db.query('select count(*) from "Round" where "gameId"=$1', [f.gameId])).rows[0].count;
  await assert.rejects(db.query('select save_draft_round($1,null,$2,$3)', [f.gameId, JSON.stringify(f.details), '[{}]']), /null value/);
  assert.equal((await db.query('select count(*) from "Round" where "gameId"=$1', [f.gameId])).rows[0].count, beforeCount);
});

test('publishing enforces dates, one active round, and immutable live questions', async () => {
  const f = await fixture();
  await db.query('update "Round" set "startsAt"=now()+interval \'1 minute\' where id=$1', [f.roundId]);
  await assert.rejects(publish(f), /before its start/);
  await db.query('update "Round" set "startsAt"=now()-interval \'1 hour\' where id=$1', [f.roundId]);
  await publish(f);
  await assert.rejects(publish(f), /Only draft/);
  await assert.rejects(db.query('select save_draft_round($1,$2,$3,$4)', [f.gameId, f.roundId, JSON.stringify(f.details), '[{"prompt":"Changed"}]']), /Only draft/);
  const { rows: [{ id }] } = await db.query('select save_draft_round($1,null,$2,$3) as id', [f.gameId, JSON.stringify(f.details), '[{"prompt":"Second"}]']);
  await assert.rejects(publish({ gameId: f.gameId, roundId: id }), /already active/);
  assert.equal((await db.query('select status from "Round" where id=$1', [id])).rows[0].status, 'DRAFT');
});

test('answer updates and clearing are atomic and reject expired or foreign questions', async () => {
  const f = await fixture(2);
  await publish(f);
  await answer(f, 'Cats', 'cat');
  await assert.rejects(answer(f, 'Wrong', 'wrong', randomUUID()), /not valid/);
  await assert.rejects(db.query('select save_round_answers($1,$2,$3)', [f.roundId, f.userId, JSON.stringify([
    { questionId: f.questions[0].id, rawAnswer: '', normalizedAnswer: '' },
    { questionId: f.questions[1].id, rawAnswer: 'Bad insert' },
  ])]), /null value/);
  assert.equal((await db.query('select "rawAnswer" from "Submission" where "userId"=$1', [f.userId])).rows[0].rawAnswer, 'Cats');
  await answer(f, '', '');
  assert.equal((await db.query('select * from "Submission" where "userId"=$1', [f.userId])).rows.length, 0);
  await expire(f.roundId);
  await assert.rejects(answer(f, 'Late'), /closed/);
});

test('scoring keeps choices distinct, includes nonresponders, and closes only once', async () => {
  const f = await fixture();
  await db.query('update "Question" set type=\'MULTIPLE_CHOICE\',choices=\'["C++","C#"]\' where id=$1', [f.questions[0].id]);
  await publish(f);
  await assert.rejects(answer(f, 'Java'), /not valid/);
  await answer(f, 'C++', 'c');
  for (const raw of ['C++', 'C#', null]) {
    const id = randomUUID();
    await db.query('insert into "User" (id,email,username) values ($1::uuid,$1::text,$1::text)', [id]);
    await db.query('insert into "GameMembership" ("gameId","userId") values ($1,$2)', [f.gameId, id]);
    if (raw) await answer({ ...f, userId: id }, raw, 'c');
  }
  assert.equal((await db.query('select close_round($1) as closed', [f.roundId])).rows[0].closed, false);
  await expire(f.roundId);
  assert.equal((await db.query('select close_round($1) as closed', [f.roundId])).rows[0].closed, true);
  const { rows: scores } = await db.query('select "totalScore",rank,"medalAwarded" from "RoundScore" where "roundId"=$1 order by "totalScore" desc', [f.roundId]);
  assert.deepEqual(scores, [
    { totalScore: 2, rank: 1, medalAwarded: true }, { totalScore: 2, rank: 1, medalAwarded: true },
    { totalScore: 1, rank: 3, medalAwarded: false }, { totalScore: 0, rank: 4, medalAwarded: false },
  ]);
  const { rows: stats } = await db.query('select "normalizedAnswer",count from "QuestionAnswerStat" where "questionId"=$1 order by count desc', [f.questions[0].id]);
  assert.deepEqual(stats, [{ normalizedAnswer: 'C++', count: 2 }, { normalizedAnswer: 'C#', count: 1 }]);
  assert.equal((await db.query('select close_round($1) as closed', [f.roundId])).rows[0].closed, false);
  await assert.rejects(answer(f, 'C#'), /closed/);
});

test('scoring includes all 1500 answers and preserves free-text matching', async () => {
  const f = await fixture(20);
  await db.query('insert into "User" (email,username) select $1 || i, $1 || i from generate_series(1,74) i', [f.gameId]);
  await db.query('insert into "GameMembership" ("gameId","userId") select $1::uuid,id from "User" where email like $1::text || \'%\'', [f.gameId]);
  await db.query('insert into "Submission" ("questionId","userId","rawAnswer","normalizedAnswer") select q.id,m."userId",\'Cats!\',\'cat\' from "Question" q cross join "GameMembership" m where q."roundId"=$1 and m."gameId"=$2', [f.roundId, f.gameId]);
  await publish(f);
  await expire(f.roundId);
  await db.query('select close_round($1)', [f.roundId]);
  const { rows: scores } = await db.query('select "totalScore" from "RoundScore" where "roundId"=$1', [f.roundId]);
  assert.equal(scores.length, 75);
  assert.ok(scores.every((score) => score.totalScore === 1500));
  const { rows: stats } = await db.query('select count,percentage from "QuestionAnswerStat" where "questionId"=$1', [f.questions[0].id]);
  assert.deepEqual(stats, [{ count: 75, percentage: 100 }]);
});

test('empty rounds award no medals and legacy emoji submissions remain distinct', async () => {
  const f = await fixture();
  await publish(f);
  await expire(f.roundId);
  await db.query('select close_round($1)', [f.roundId]);
  assert.deepEqual((await db.query('select "totalScore","medalAwarded" from "RoundScore" where "roundId"=$1', [f.roundId])).rows, [{ totalScore: 0, medalAwarded: false }]);
  const emojis = await fixture();
  await publish(emojis);
  await answer(emojis, '🌮', '');
  const second = randomUUID();
  await db.query('insert into "User" (id,email,username) values ($1::uuid,$1::text,$1::text)', [second]);
  await db.query('insert into "GameMembership" ("gameId","userId") values ($1,$2)', [emojis.gameId, second]);
  await answer({ ...emojis, userId: second }, '🍕', '');
  await expire(emojis.roundId);
  await db.query('select close_round($1)', [emojis.roundId]);
  assert.equal((await db.query('select * from "QuestionAnswerStat" where "questionId"=$1', [emojis.questions[0].id])).rows.length, 2);
});

test('suggestion promotion respects capacity and rolls back review state on failure', async () => {
  const f = await fixture(20);
  const { rows: [{ id }] } = await db.query('insert into "QuestionSuggestion" ("gameId","submittedById",prompt) values ($1,$2,\'Suggestion\') returning id', [f.gameId, f.userId]);
  await assert.rejects(db.query('select promote_suggestion($1,$2,$3)', [f.gameId, f.roundId, id]), /maximum 20/);
  assert.equal((await db.query('select status from "QuestionSuggestion" where id=$1', [id])).rows[0].status, 'PENDING');
  await db.query('delete from "Question" where id=$1', [f.questions[0].id]);
  await db.query('select promote_suggestion($1,$2,$3)', [f.gameId, f.roundId, id]);
  await assert.rejects(db.query('select promote_suggestion($1,$2,$3)', [f.gameId, f.roundId, id]), /already reviewed/);
  assert.equal((await db.query('select count(*) from "Question" where "roundId"=$1', [f.roundId])).rows[0].count, 20);
});

test('transactional functions are unavailable to public API roles', async () => {
  const { rows } = await db.query("select has_function_privilege('anon', 'public.close_round(uuid)', 'execute') as anon, has_function_privilege('authenticated', 'public.save_round_answers(uuid,uuid,jsonb)', 'execute') as authenticated, has_function_privilege('service_role', 'public.close_round(uuid)', 'execute') as service");
  assert.deepEqual(rows, [{ anon: false, authenticated: false, service: true }]);
});

test('failed scoring leaves prior results and round status intact', async (t) => {
  const f = await fixture();
  await publish(f);
  await answer(f, 'Cats', 'cat');
  await expire(f.roundId);
  await db.query('insert into "RoundScore" ("roundId","userId","totalScore",rank) values ($1,$2,7,1)', [f.roundId, f.userId]);
  await db.query('insert into "QuestionAnswerStat" ("questionId","normalizedAnswer","displayAnswer",count,percentage) values ($1,\'previous\',\'Previous\',7,100)', [f.questions[0].id]);
  await db.exec(`create function reject_test_score() returns trigger language plpgsql as $$ begin raise exception 'simulated scoring failure'; end $$;
    create trigger reject_test_score before insert on "RoundScore" for each row execute function reject_test_score();`);
  t.after(() => db.exec('drop trigger reject_test_score on "RoundScore"; drop function reject_test_score();'));
  await assert.rejects(db.query('select close_round($1)', [f.roundId]), /simulated scoring failure/);
  assert.equal((await db.query('select status from "Round" where id=$1', [f.roundId])).rows[0].status, 'ACTIVE');
  assert.equal((await db.query('select "totalScore" from "RoundScore" where "roundId"=$1', [f.roundId])).rows[0].totalScore, 7);
  assert.equal((await db.query('select "normalizedAnswer" from "QuestionAnswerStat" where "questionId"=$1', [f.questions[0].id])).rows[0].normalizedAnswer, 'previous');
});
