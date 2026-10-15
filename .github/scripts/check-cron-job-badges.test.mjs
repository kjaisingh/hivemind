import assert from 'node:assert/strict';
import test from 'node:test';
import { expectedCycle, jobs, parseBadge, statusForJob, updateBody } from './check-cron-job-badges.mjs';

const badge = (message) => `<svg xmlns="http://www.w3.org/2000/svg"><text><tspan>Job title</tspan></text><text fill="#fff"><tspan>${message}</tspan></text></svg>`;
const issue = `Automated keepalive watch.\n\n| Scheduled cycle (ET) | Jeopardy | Hivemind | Trigger | Atlantis | Monitor |\n| --- | --- | --- | --- | --- | --- |\n<!-- keepalive-monitor:end -->`;

test('parses a badge result and fails closed on changed markup', () => {
  assert.deepEqual(parseBadge(badge('success (18:05)')), { status: 'success', time: '18:05' });
  assert.deepEqual(parseBadge(badge('not run yet')), { status: 'not run yet' });
  assert.deepEqual(parseBadge(badge('failure (18:05)')), { status: 'failure or unknown format' });
  assert.throws(() => parseBadge('<svg></svg>'), /unexpected format/);
});

test('expects each staggered run after the thirty-minute grace', () => {
  const at0045 = new Date('2026-10-16T04:45:00Z');
  const at0645 = new Date('2026-10-16T10:45:00Z');
  assert.deepEqual(jobs.map(({ minute }) => expectedCycle(at0045, minute)), [
    '2026-10-16 00:00', '2026-10-16 00:05', '2026-10-16 00:10', '2026-10-16 00:15',
  ]);
  assert.deepEqual(jobs.map(({ minute }) => expectedCycle(at0645, minute)), [
    '2026-10-16 06:00', '2026-10-16 06:05', '2026-10-16 06:10', '2026-10-16 06:15',
  ]);
});

test('rejects a stale badge even when it still says success', () => {
  const at1845 = new Date('2026-10-15T22:45:00Z');
  assert.equal(statusForJob(jobs[0], parseBadge(badge('success (18:00)')), at1845).ok, true);
  assert.equal(statusForJob(jobs[0], parseBadge(badge('success (12:00)')), at1845).ok, false);
});

test('tracking issue detects missed monitor cycles and replaces reruns', () => {
  const good = jobs.map(() => ({ ok: true, text: '✅ on time' }));
  const first = updateBody(issue, '2026-10-15 18:00', good);
  assert.equal(first.anomaly, false);
  const rerun = updateBody(first.nextBody, '2026-10-15 18:00', good);
  assert.equal((rerun.nextBody.match(/\| 2026-10-15 18:00 \|/g) ?? []).length, 1);
  assert.equal(rerun.nextBody, first.nextBody);
  const gap = updateBody(rerun.nextBody, '2026-10-16 06:00', good);
  assert.equal(gap.gapCount, 1);
  assert.equal(gap.anomaly, true);
  assert.match(gap.nextBody, /missed 1 monitor cycle/);
  const missedFirst = updateBody(issue, '2026-10-16 00:00', good);
  assert.equal(missedFirst.gapCount, 1);
  assert.equal(missedFirst.anomaly, true);
});
