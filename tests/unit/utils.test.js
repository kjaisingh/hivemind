import assert from 'node:assert/strict';
import test from 'node:test';
import dayjs from 'dayjs';
import { formatTimeRemaining, getUrgencyTier } from '../../src/lib/countdown.js';
import { normalizeAnswer, rankByPoints, toHoursArray } from '../../server/utils.js';
import { formatJoinCode } from '../../src/lib/joinCode.js';
import { resolveGameTab } from '../../src/lib/gameTabs.js';

test('normalizeAnswer ignores case, punctuation, spacing, and simple plurals', () => {
  assert.equal(normalizeAnswer('  Cats!!!  '), 'cat');
  assert.equal(normalizeAnswer('New   York'), 'new york');
  assert.equal(normalizeAnswer('CAFÉ'), 'café');
  assert.equal(normalizeAnswer('東京！'), '東京');
  assert.equal(normalizeAnswer('🌮'), '🌮');
  assert.notEqual(normalizeAnswer('🌮'), normalizeAnswer('🍕'));
});

test('normalizeAnswer does not corrupt words that merely end in s', () => {
  assert.equal(normalizeAnswer('bus glass analysis'), 'bus glass analysis');
});

test('join codes format as users type and tabs reject inaccessible values', () => {
  assert.equal(formatJoinCode('abc234'), 'ABC-234');
  assert.equal(formatJoinCode('abc-234-extra'), 'ABC-234');
  assert.equal(formatJoinCode('i1o0'), '');
  assert.equal(resolveGameTab('history', false), 'history');
  assert.equal(resolveGameTab('manage', false), 'active');
  assert.equal(resolveGameTab('manage', true), 'manage');
  assert.equal(resolveGameTab('unknown', true), 'active');
});

test('toHoursArray keeps only positive finite values', () => {
  assert.deepEqual(toHoursArray('24, 1, 0, nope, -4, Infinity'), [24, 1]);
});

test('countdown keeps the final partial minute open', () => {
  const now = dayjs('2026-01-01T00:00:00Z');
  assert.equal(formatTimeRemaining(now.add(59, 'second'), now), '1m left');
  assert.equal(getUrgencyTier(now.add(59, 'second'), now), 'danger');
  assert.equal(formatTimeRemaining(now, now), 'closed');
});

test('season ranking gives tied scores the same competition rank', () => {
  const ranked = rankByPoints([
    { username: 'zara', points: 10 },
    { username: 'amy', points: 10 },
    { username: 'lee', points: 4 },
  ]);
  assert.deepEqual(ranked.map(({ username, rank }) => [username, rank]), [['amy', 1], ['zara', 1], ['lee', 3]]);
});
