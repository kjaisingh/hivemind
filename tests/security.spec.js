import { test, expect } from '@playwright/test';
import { uniqueEmail, uniqueUsername, signup } from './helpers.js';

const API_ORIGIN = `http://localhost:${process.env.PORT || 3001}`;

test.setTimeout(60_000);

test('cross-game publish is rejected with 404, not another game\'s round', async ({ browser }) => {
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()]);
  const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);

  const adminA = { email: uniqueEmail('sec_a'), username: uniqueUsername('sec_a'), password: 'correct-horse-battery' };
  const adminB = { email: uniqueEmail('sec_b'), username: uniqueUsername('sec_b'), password: 'correct-horse-battery' };
  await Promise.all([signup(pageA, adminA), signup(pageB, adminB)]);

  await pageA.getByPlaceholder('Game name').fill('Game A');
  await pageA.getByPlaceholder('Game description').fill('Owned by admin A.');
  await pageA.getByRole('button', { name: 'Create Game' }).click();
  await expect(pageA).toHaveURL(/\/games\//);
  const gameAId = new URL(pageA.url()).pathname.split('/')[2];

  await pageB.getByPlaceholder('Game name').fill('Game B');
  await pageB.getByPlaceholder('Game description').fill('Owned by admin B.');
  await pageB.getByRole('button', { name: 'Create Game' }).click();
  await expect(pageB).toHaveURL(/\/games\//);
  const gameBId = new URL(pageB.url()).pathname.split('/')[2];

  const createRes = await pageA.request.post(`${API_ORIGIN}/api/games/${gameAId}/rounds`, {
    data: {
      name: 'Round A',
      description: 'Belongs to game A.',
      startsAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      questions: [{ prompt: 'Q1?' }],
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const { roundId: roundAId } = await createRes.json();

  // Admin B tries to publish game A's round through their own game's URL.
  const crossPublish = await pageB.request.post(`${API_ORIGIN}/api/games/${gameBId}/rounds/${roundAId}/publish`, {
    data: { announcement: 'attacker-controlled blast' },
  });
  expect(crossPublish.status()).toBe(404);

  // The round must remain untouched (still a draft, no announcement recorded).
  const detailRes = await pageA.request.get(`${API_ORIGIN}/api/games/${gameAId}`);
  const detail = await detailRes.json();
  expect(detail.game.draftRounds.some((r) => r.id === roundAId)).toBe(true);
  expect(detail.game.activeRound).toBeNull();

  await Promise.all([ctxA.close(), ctxB.close()]);
});

test('cross-game results access is rejected: outsiders get 403, wrong-game round id gets 404', async ({ browser }) => {
  const [ctxA, ctxB, ctxOutsider] = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  const [pageA, pageB, pageOutsider] = await Promise.all([ctxA.newPage(), ctxB.newPage(), ctxOutsider.newPage()]);

  const adminA = { email: uniqueEmail('sec_ra'), username: uniqueUsername('sec_ra'), password: 'correct-horse-battery' };
  const adminB = { email: uniqueEmail('sec_rb'), username: uniqueUsername('sec_rb'), password: 'correct-horse-battery' };
  const outsider = { email: uniqueEmail('sec_out'), username: uniqueUsername('sec_out'), password: 'correct-horse-battery' };
  await Promise.all([signup(pageA, adminA), signup(pageB, adminB), signup(pageOutsider, outsider)]);

  await pageA.getByPlaceholder('Game name').fill('Results Game A');
  await pageA.getByPlaceholder('Game description').fill('Owned by admin A.');
  await pageA.getByRole('button', { name: 'Create Game' }).click();
  await expect(pageA).toHaveURL(/\/games\//);
  const gameAId = new URL(pageA.url()).pathname.split('/')[2];

  await pageB.getByPlaceholder('Game name').fill('Results Game B');
  await pageB.getByPlaceholder('Game description').fill('Owned by admin B.');
  await pageB.getByRole('button', { name: 'Create Game' }).click();
  await expect(pageB).toHaveURL(/\/games\//);
  const gameBId = new URL(pageB.url()).pathname.split('/')[2];

  const expiresAt = new Date(Date.now() + 5_000).toISOString();
  const createRes = await pageA.request.post(`${API_ORIGIN}/api/games/${gameAId}/rounds`, {
    data: {
      name: 'Round A',
      description: 'Belongs to game A.',
      startsAt: new Date().toISOString(),
      expiresAt,
      questions: [{ prompt: 'Q1?' }],
    },
  });
  const { roundId: roundAId } = await createRes.json();
  const publishRes = await pageA.request.post(`${API_ORIGIN}/api/games/${gameAId}/rounds/${roundAId}/publish`, {
    data: { announcement: '' },
  });
  expect(publishRes.ok()).toBeTruthy();

  // Outsider (not a member of game A at all) is blocked at the role check.
  const outsiderRes = await pageOutsider.request.get(
    `${API_ORIGIN}/api/games/${gameAId}/rounds/${roundAId}/results`,
  );
  expect(outsiderRes.status()).toBe(403);

  // Admin B is a member of game B, but tries to fetch game A's round through game B's URL.
  const wrongGameRes = await pageB.request.get(
    `${API_ORIGIN}/api/games/${gameBId}/rounds/${roundAId}/results`,
  );
  expect(wrongGameRes.status()).toBe(404);

  await Promise.all([ctxA.close(), ctxB.close(), ctxOutsider.close()]);
});

test('no response ever leaks passwordHash or googleId', async ({ page }) => {
  const user = { email: uniqueEmail('sec_leak'), username: uniqueUsername('sec_leak'), password: 'correct-horse-battery' };
  await signup(page, user);

  await page.getByPlaceholder('Game name').fill('Leak Check Game');
  await page.getByPlaceholder('Game description').fill('Checking for leaked fields.');
  await page.getByRole('button', { name: 'Create Game' }).click();
  await expect(page).toHaveURL(/\/games\//);
  const gameId = new URL(page.url()).pathname.split('/')[2];

  const responses = await Promise.all([
    page.request.get(`${API_ORIGIN}/api/auth/me`),
    page.request.get(`${API_ORIGIN}/api/dashboard`),
    page.request.get(`${API_ORIGIN}/api/games/${gameId}`),
  ]);

  for (const res of responses) {
    const text = await res.text();
    expect(text).not.toContain('passwordHash');
    expect(text).not.toContain('googleId');
  }
});
