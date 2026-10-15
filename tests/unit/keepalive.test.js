import assert from 'node:assert/strict';
import test from 'node:test';
import { createKeepaliveProbe } from '../../server/keepalive.js';

function createSupabaseMock(responses = []) {
  const calls = [];

  return {
    calls,
    client: {
      from(table) {
        return {
          select(columns) {
            return {
              async limit(value) {
                calls.push({ table, columns, value });
                return responses.shift() ?? { data: [{ id: 'private-id' }], error: null };
              },
            };
          },
        };
      },
    },
  };
}

test('keepalive performs three fixed reads and caches successful probes', async () => {
  let currentTime = 1_000;
  const supabase = createSupabaseMock();
  const probe = createKeepaliveProbe(supabase.client, {
    cooldownMs: 500,
    now: () => currentTime,
  });

  assert.deepEqual(await probe(), { cached: false, checkedAt: new Date(1_000).toISOString() });
  assert.deepEqual(await probe(), { cached: true, checkedAt: new Date(1_000).toISOString() });
  assert.equal(supabase.calls.length, 3);
  assert.deepEqual(supabase.calls[0], { table: 'User', columns: 'id', value: 1 });

  currentTime += 500;
  assert.deepEqual(await probe(), { cached: false, checkedAt: new Date(1_500).toISOString() });
  assert.equal(supabase.calls.length, 6);
});

test('keepalive coalesces concurrent probes', async () => {
  let releaseFirstQuery;
  const firstQuery = new Promise((resolve) => {
    releaseFirstQuery = resolve;
  });
  const supabase = createSupabaseMock([firstQuery]);
  const probe = createKeepaliveProbe(supabase.client, { now: () => 2_000 });

  const firstProbe = probe();
  const secondProbe = probe();
  releaseFirstQuery({ data: [], error: null });

  assert.deepEqual(await Promise.all([firstProbe, secondProbe]), [
    { cached: false, checkedAt: new Date(2_000).toISOString() },
    { cached: false, checkedAt: new Date(2_000).toISOString() },
  ]);
  assert.equal(supabase.calls.length, 3);
});

test('keepalive failures are not cached and database data is never returned', async () => {
  const supabase = createSupabaseMock([
    { data: null, error: { message: 'database unavailable', code: 'PGRST000' } },
  ]);
  const probe = createKeepaliveProbe(supabase.client, { now: () => 3_000 });

  await assert.rejects(probe(), { message: 'database unavailable', code: 'PGRST000' });
  assert.deepEqual(await probe(), { cached: false, checkedAt: new Date(3_000).toISOString() });
  assert.equal(supabase.calls.length, 4);
});
