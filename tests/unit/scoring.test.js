import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
const { scoreRound } = await import('../../server/scoring.js');

test('scoring tolerates another writer inserting derived rows after deletion', async () => {
  const tables = {
    Round: [{ id: 'round-1', gameId: 'game-1' }],
    GameMembership: [{ gameId: 'game-1', userId: 'user-1' }, { gameId: 'game-1', userId: 'user-2' }],
    User: [{ id: 'user-1', username: 'One' }, { id: 'user-2', username: 'Two' }],
    Question: [{ id: 'question-1', roundId: 'round-1', position: 1 }],
    Submission: [
      { questionId: 'question-1', userId: 'user-1', rawAnswer: 'Taco' },
      { questionId: 'question-1', userId: 'user-2', rawAnswer: 'tacos' },
    ],
    QuestionAnswerStat: [],
    RoundScore: [],
  };
  const conflictingWrites = new Set(['QuestionAnswerStat', 'RoundScore']);

  const supabase = {
    from(table) {
      const filters = [];
      let action = 'select';
      let start = 0;
      let end = 999;
      const matching = (row) => filters.every((filter) => filter(row));

      return {
        select() { return this; },
        eq(column, value) { filters.push((row) => row[column] === value); return this; },
        in(column, values) { filters.push((row) => values.includes(row[column])); return this; },
        order() { return this; },
        range(from, to) { start = from; end = to; return this; },
        delete() { action = 'delete'; return this; },
        async maybeSingle() { return { data: tables[table].find(matching) || null, error: null }; },
        async upsert(rows, { onConflict }) {
          const keys = onConflict.split(',');
          for (const row of rows) {
            const existing = tables[table].find((item) => keys.every((key) => item[key] === row[key]));
            if (existing) Object.assign(existing, row);
            else tables[table].push({ ...row });
          }
          return { data: null, error: null };
        },
        then(resolve, reject) {
          if (action === 'delete') {
            tables[table] = tables[table].filter((row) => !matching(row));
            if (conflictingWrites.delete(table)) {
              if (table === 'QuestionAnswerStat') {
                tables[table].push({ questionId: 'question-1', normalizedAnswer: 'taco', count: 1 });
              } else {
                tables[table].push({ roundId: 'round-1', userId: 'user-1', totalScore: 1 });
              }
            }
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: tables[table].filter(matching).slice(start, end + 1), error: null }).then(resolve, reject);
        },
      };
    },
  };

  await scoreRound(supabase, 'round-1');
  await scoreRound(supabase, 'round-1');

  assert.equal(tables.QuestionAnswerStat.length, 1);
  assert.equal(tables.QuestionAnswerStat[0].count, 2);
  assert.equal(tables.QuestionAnswerStat[0].percentage, 100);
  assert.deepEqual(tables.RoundScore.map((row) => row.totalScore), [2, 2]);
});
