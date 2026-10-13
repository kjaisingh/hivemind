import assert from 'node:assert/strict';
import test from 'node:test';
import dayjs from 'dayjs';
import { formatTimeRemaining, getUrgencyTier } from '../../src/lib/countdown.js';
import { normalizeAnswer, safeDisplayAnswer, toHoursArray } from '../../server/utils.js';

test('normalizeAnswer ignores case, punctuation, spacing, and simple plurals', () => {
  assert.equal(normalizeAnswer('  Cats!!!  '), 'cat');
  assert.equal(normalizeAnswer('New   York'), 'new york');
});

test('safeDisplayAnswer preserves text while collapsing whitespace', () => {
  assert.equal(safeDisplayAnswer('  New\n  York  '), 'New York');
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
