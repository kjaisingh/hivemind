import { test, expect } from '@playwright/test';
import { uniqueEmail, uniqueUsername, signup } from './helpers.js';

const API_ORIGIN = `http://localhost:${process.env.PORT || 3001}`;

test.setTimeout(60_000);

test('two players who answer identically tie for rank 1 and both earn a medal', async ({ browser }) => {
  const adminContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const playerPage = await playerContext.newPage();

  const admin = { email: uniqueEmail('admin'), username: uniqueUsername('admin'), password: 'correct-horse-battery' };
  const player = { email: uniqueEmail('player'), username: uniqueUsername('player'), password: 'correct-horse-battery' };

  await signup(adminPage, admin);
  await signup(playerPage, player);

  // Admin creates the game via the real UI form.
  await adminPage.getByPlaceholder('Game name').fill('Trivia Hive');
  await adminPage.getByPlaceholder('Game description').fill('A game for automated testing.');
  await adminPage.getByRole('button', { name: 'Create Game' }).click();
  await expect(adminPage).toHaveURL(/\/games\//);
  const gameId = new URL(adminPage.url()).pathname.split('/')[2];

  await adminPage.getByRole('tab', { name: 'Share' }).click();
  const code = await adminPage.getByLabel('Game code').inputValue();

  // Player joins by code via the real UI form.
  await playerPage.getByPlaceholder('Enter game code (ABC-123)').fill(code);
  await playerPage.getByRole('button', { name: 'Join' }).click();
  await expect(playerPage).toHaveURL(new RegExp(`/games/${gameId}$`));

  // Seed a short-lived round directly through the API so the test doesn't have
  // to wait out the datetime-local input's one-minute UI granularity.
  const expiresAt = new Date(Date.now() + 20_000).toISOString();
  const createRes = await adminPage.request.post(`${API_ORIGIN}/api/games/${gameId}/rounds`, {
    data: {
      name: 'Speed Round',
      description: 'Quick round for automated testing.',
      startsAt: new Date().toISOString(),
      expiresAt,
      questions: [{ prompt: 'Favorite color?' }, { prompt: 'Favorite season?' }],
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const { roundId } = await createRes.json();

  const publishRes = await adminPage.request.post(`${API_ORIGIN}/api/games/${gameId}/rounds/${roundId}/publish`, {
    data: { announcement: 'Go answer!' },
  });
  expect(publishRes.ok()).toBeTruthy();

  // Both players answer identically through the real UI.
  await adminPage.reload();
  await playerPage.reload();

  for (const p of [adminPage, playerPage]) {
    await p.getByLabel('Favorite color?').fill('Blue');
    await p.getByLabel('Favorite season?').fill('Summer');
    await p.getByRole('button', { name: 'Save' }).click();
    await expect(p.getByText('Answers saved.')).toBeVisible();
  }

  // Wait past expiry, then trigger processRounds (runs inline on any GET) by reloading.
  const waitMs = new Date(expiresAt).getTime() - Date.now() + 2_000;
  if (waitMs > 0) {
    await adminPage.waitForTimeout(waitMs);
  }
  await adminPage.reload();
  await playerPage.reload();

  await adminPage.goto(`/games/${gameId}/rounds/${roundId}/results`);
  await playerPage.goto(`/games/${gameId}/rounds/${roundId}/results`);

  await expect(adminPage.getByText('Your score: 4 points')).toBeVisible();
  await expect(playerPage.getByText('Your score: 4 points')).toBeVisible();
  await expect(adminPage.getByText(/Weekly rank: #1/)).toBeVisible();
  await expect(playerPage.getByText(/Weekly rank: #1/)).toBeVisible();

  await expect(adminPage.getByRole('cell', { name: admin.username })).toBeVisible();
  await expect(adminPage.getByRole('cell', { name: player.username })).toBeVisible();

  // Confirm the underlying data contract too, beyond what the medal emoji in the UI implies.
  const resultsJson = await adminPage.request
    .get(`${API_ORIGIN}/api/games/${gameId}/rounds/${roundId}/results`)
    .then((r) => r.json());
  expect(resultsJson.round.ownScore.medalAwarded).toBe(true);
  expect(resultsJson.round.ownScore.totalScore).toBe(4);
  expect(resultsJson.round.ownScore.rank).toBe(1);

  const stats = resultsJson.round.questions.flatMap((q) => q.stats);
  expect(stats.every((stat) => stat.count === 2 && stat.percentage === 100)).toBe(true);

  await adminContext.close();
  await playerContext.close();
});
