import { expect, test } from '@playwright/test';
import { signup, uniqueEmail, uniqueUsername } from './helpers.js';

const API_ORIGIN = `http://localhost:${process.env.PORT || 3001}`;

async function createDraft(page, gameId, name) {
  const response = await page.request.post(`${API_ORIGIN}/api/games/${gameId}/rounds`, {
    data: {
      name,
      description: 'Round-state regression coverage.',
      startsAt: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      questions: [{ prompt: 'Pick a color?' }],
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test('round state prevents republish, concurrent active rounds, and early results', async ({ page }) => {
  await signup(page, {
    email: uniqueEmail('state'),
    username: uniqueUsername('state'),
    password: 'correct-horse-battery',
  });
  await page.getByPlaceholder('Game name').fill('State Machine Hive');
  await page.getByPlaceholder('Game description').fill('Checks round transitions.');
  await page.getByRole('button', { name: 'Create Game' }).click();
  const gameId = new URL(page.url()).pathname.split('/')[2];

  const { roundId } = await createDraft(page, gameId, 'First round');
  const publish = await page.request.post(`${API_ORIGIN}/api/games/${gameId}/rounds/${roundId}/publish`, {
    data: { announcement: '' },
  });
  expect(publish.ok()).toBeTruthy();

  const republish = await page.request.post(`${API_ORIGIN}/api/games/${gameId}/rounds/${roundId}/publish`, {
    data: { announcement: '' },
  });
  expect(republish.status()).toBe(409);

  const results = await page.request.get(`${API_ORIGIN}/api/games/${gameId}/rounds/${roundId}/results`);
  expect(results.status()).toBe(409);

  const second = await createDraft(page, gameId, 'Second round');
  const secondPublish = await page.request.post(
    `${API_ORIGIN}/api/games/${gameId}/rounds/${second.roundId}/publish`,
    { data: { announcement: '' } },
  );
  expect(secondPublish.status()).toBe(409);

  const progress = await page.request
    .get(`${API_ORIGIN}/api/games/${gameId}/rounds/${roundId}/progress`)
    .then((response) => response.json());
  expect(progress).toEqual({ submittedCount: 0, totalCount: 1 });
  expect(JSON.stringify(progress)).not.toContain('userId');
});
