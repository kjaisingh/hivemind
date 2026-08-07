import { test, expect } from '@playwright/test';
import { uniqueEmail, uniqueUsername, signup } from './helpers.js';

const API_ORIGIN = `http://localhost:${process.env.PORT || 3001}`;

test.setTimeout(60_000);

test('differentiated answers produce split scores, a rank break, and a no-answer fallback', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const [adminPage, bPage, cPage] = pages;

  const admin = { email: uniqueEmail('res_admin'), username: uniqueUsername('res_admin'), password: 'correct-horse-battery' };
  const b = { email: uniqueEmail('res_b'), username: uniqueUsername('res_b'), password: 'correct-horse-battery' };
  const c = { email: uniqueEmail('res_c'), username: uniqueUsername('res_c'), password: 'correct-horse-battery' };

  await Promise.all([signup(adminPage, admin), signup(bPage, b), signup(cPage, c)]);

  await adminPage.getByPlaceholder('Game name').fill('Results Spec Game');
  await adminPage.getByPlaceholder('Game description').fill('Exercises differentiated scoring.');
  await adminPage.getByRole('button', { name: 'Create Game' }).click();
  await expect(adminPage).toHaveURL(/\/games\//);
  const gameId = new URL(adminPage.url()).pathname.split('/')[2];

  await adminPage.getByRole('button', { name: 'Share' }).click();
  const code = await adminPage.getByLabel('Game code').inputValue();

  for (const p of [bPage, cPage]) {
    await p.getByPlaceholder('Enter game code (ABC-123)').fill(code);
    await p.getByRole('button', { name: 'Join' }).click();
    await expect(p).toHaveURL(new RegExp(`/games/${gameId}$`));
  }

  const expiresAt = new Date(Date.now() + 20_000).toISOString();
  const createRes = await adminPage.request.post(`${API_ORIGIN}/api/games/${gameId}/rounds`, {
    data: {
      name: 'Split Round',
      description: 'Differentiated answers.',
      startsAt: new Date().toISOString(),
      expiresAt,
      questions: ['Favorite color?', 'Favorite season?'],
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const { roundId } = await createRes.json();

  const publishRes = await adminPage.request.post(`${API_ORIGIN}/api/games/${gameId}/rounds/${roundId}/publish`, {
    data: { announcement: 'Go answer!' },
  });
  expect(publishRes.ok()).toBeTruthy();

  await Promise.all(pages.map((p) => p.reload()));

  // Admin and B agree on color, disagree on season; C answers color differently and skips season entirely.
  await adminPage.getByLabel('Favorite color?').fill('Blue');
  await adminPage.getByLabel('Favorite season?').fill('Summer');
  await adminPage.getByRole('button', { name: 'Save' }).click();
  await expect(adminPage.getByText('Answers saved.')).toBeVisible();

  await bPage.getByLabel('Favorite color?').fill('Blue');
  await bPage.getByLabel('Favorite season?').fill('Winter');
  await bPage.getByRole('button', { name: 'Save' }).click();
  await expect(bPage.getByText('Answers saved.')).toBeVisible();

  await cPage.getByLabel('Favorite color?').fill('Red');
  await cPage.getByRole('button', { name: 'Save' }).click();
  await expect(cPage.getByText('Answers saved.')).toBeVisible();

  const waitMs = new Date(expiresAt).getTime() - Date.now() + 2_000;
  if (waitMs > 0) {
    await adminPage.waitForTimeout(waitMs);
  }
  await Promise.all(pages.map((p) => p.reload()));
  await Promise.all(pages.map((p) => p.goto(`/games/${gameId}/rounds/${roundId}/results`)));

  // Admin and B each score 2 (color) + 1 (own unique season) = 3, tied for rank 1 with a medal.
  // C scores 1 (color) + 0 (no season submission) = 1, alone at rank 3, no medal.
  await expect(adminPage.getByText('Your score: 3 points')).toBeVisible();
  await expect(adminPage.getByText(/Weekly rank: #1/)).toBeVisible();
  await expect(bPage.getByText('Your score: 3 points')).toBeVisible();
  await expect(bPage.getByText(/Weekly rank: #1/)).toBeVisible();
  await expect(cPage.getByText('Your score: 1 points')).toBeVisible();
  await expect(cPage.getByText(/Weekly rank: #3/)).toBeVisible();

  await expect(cPage.getByText('No answer submitted')).toBeVisible();

  const resultsJson = await adminPage.request
    .get(`${API_ORIGIN}/api/games/${gameId}/rounds/${roundId}/results`)
    .then((r) => r.json());

  const byUsername = Object.fromEntries(resultsJson.round.leaderboard.map((row) => [row.username, row]));
  expect(byUsername[admin.username].totalScore).toBe(3);
  expect(byUsername[admin.username].rank).toBe(1);
  expect(byUsername[b.username].totalScore).toBe(3);
  expect(byUsername[b.username].rank).toBe(1);
  expect(byUsername[c.username].totalScore).toBe(1);
  expect(byUsername[c.username].rank).toBe(3);

  const colorStats = resultsJson.round.questions.find((q) => q.prompt === 'Favorite color?').stats;
  const blue = colorStats.find((s) => s.displayAnswer === 'Blue');
  const red = colorStats.find((s) => s.displayAnswer === 'Red');
  expect(blue.count).toBe(2);
  expect(Math.round(blue.percentage)).toBe(67);
  expect(red.count).toBe(1);
  expect(Math.round(red.percentage)).toBe(33);

  const seasonStats = resultsJson.round.questions.find((q) => q.prompt === 'Favorite season?').stats;
  expect(seasonStats.every((s) => s.count === 1)).toBe(true);
  expect(seasonStats.length).toBe(2);

  await Promise.all(contexts.map((ctx) => ctx.close()));
});
