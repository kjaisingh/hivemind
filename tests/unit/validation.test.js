import assert from 'node:assert/strict';
import test from 'node:test';
import {
  answersSchema,
  emailSettingsSchema,
  loginSchema,
  roundSchema,
} from '../../server/validation.js';

const validRound = {
  name: 'Friday predictions',
  description: '',
  startsAt: '2026-01-01T12:00:00.000Z',
  expiresAt: '2026-01-02T12:00:00.000Z',
  questions: [{ prompt: 'Pick one', type: 'MULTIPLE_CHOICE', choices: ['Tea', 'Coffee'] }],
};

test('login validation handles missing bodies without throwing', () => {
  assert.equal(loginSchema.safeParse(undefined).success, false);
  assert.equal(loginSchema.safeParse({ email: 'USER@example.com', password: 'secret' }).data.email, 'user@example.com');
});

test('round validation enforces date order and unique choices', () => {
  assert.equal(roundSchema.safeParse(validRound).success, true);
  assert.equal(roundSchema.safeParse({ ...validRound, expiresAt: validRound.startsAt }).success, false);
  assert.equal(
    roundSchema.safeParse({
      ...validRound,
      questions: [{ prompt: 'Pick one', type: 'MULTIPLE_CHOICE', choices: ['Tea', 'tea'] }],
    }).success,
    false,
  );
});

test('answer validation rejects duplicate and oversized submissions while allowing clearing', () => {
  const questionId = '123e4567-e89b-12d3-a456-426614174000';
  assert.equal(answersSchema.safeParse({ answers: [{ questionId, answer: '' }] }).success, true);
  assert.equal(
    answersSchema.safeParse({ answers: [{ questionId, answer: 'one' }, { questionId, answer: 'two' }] }).success,
    false,
  );
  assert.equal(answersSchema.safeParse({ answers: [{ questionId, answer: 'x'.repeat(501) }] }).success, false);
});

test('email hours are bounded, unique, and sorted', () => {
  const parsed = emailSettingsSchema.parse({ autoRoundOpen: true, autoResultsLive: false, expiringHours: [1, 24, 1] });
  assert.deepEqual(parsed.expiringHours, [24, 1]);
  assert.equal(
    emailSettingsSchema.safeParse({ autoRoundOpen: true, autoResultsLive: false, expiringHours: [169] }).success,
    false,
  );
});
