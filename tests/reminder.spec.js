import { test, expect } from '@playwright/test';
import { uniqueEmail, uniqueUsername, signup } from './helpers.js';

const API_ORIGIN = `http://localhost:${process.env.PORT || 3001}`;

test.setTimeout(60_000);

test('admin can remind players with unanswered questions, and non-admins cannot', async ({ browser }) => {
  const adminContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const playerPage = await playerContext.newPage();

  const admin = { email: uniqueEmail('rem_admin'), username: uniqueUsername('rem_admin'), password: 'correct-horse-battery' };
  const player = { email: uniqueEmail('rem_player'), username: uniqueUsername('rem_player'), password: 'correct-horse-battery' };

  await signup(adminPage, admin);
  await signup(playerPage, player);

  await adminPage.getByPlaceholder('Game name').fill('Reminder Hive');
  await adminPage.getByPlaceholder('Game description').fill('A game for reminder testing.');
  await adminPage.getByRole('button', { name: 'Create Game' }).click();
  await expect(adminPage).toHaveURL(/\/games\//);
  const gameId = new URL(adminPage.url()).pathname.split('/')[2];

  await adminPage.getByRole('tab', { name: 'Share' }).click();
  const code = await adminPage.getByLabel('Game code').inputValue();

  await playerPage.getByPlaceholder('Enter game code (ABC-123)').fill(code);
  await playerPage.getByRole('button', { name: 'Join' }).click();
  await expect(playerPage).toHaveURL(new RegExp(`/games/${gameId}$`));

  const createRes = await adminPage.request.post(`${API_ORIGIN}/api/games/${gameId}/rounds`, {
    data: {
      name: 'Reminder Round',
      description: 'Round for reminder testing.',
      startsAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      questions: [{ prompt: 'Favorite food?' }],
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const { roundId } = await createRes.json();

  const publishRes = await adminPage.request.post(`${API_ORIGIN}/api/games/${gameId}/rounds/${roundId}/publish`, {
    data: { announcement: 'Go answer!' },
  });
  expect(publishRes.ok()).toBeTruthy();

  // Non-admin never sees the trigger, and the API rejects it directly.
  await playerPage.reload();
  await expect(playerPage.getByRole('button', { name: 'Remind pending players' })).toHaveCount(0);
  const playerAttempt = await playerPage.request.post(`${API_ORIGIN}/api/games/${gameId}/rounds/${roundId}/remind`);
  expect(playerAttempt.status()).toBe(403);

  // Admin answers their own copy first, so only the player remains pending.
  await adminPage.reload();
  await adminPage.getByLabel('Favorite food?').fill('Tacos');
  await adminPage.getByRole('button', { name: 'Save' }).click();
  await expect(adminPage.getByText('Answers saved.')).toBeVisible();

  await adminPage.getByRole('button', { name: 'Remind pending players' }).click();
  await expect(adminPage.getByText('Reminded 1 player(s) with unanswered questions.')).toBeVisible();

  // Player answers, then the admin reminding again finds nobody pending.
  await playerPage.getByLabel('Favorite food?').fill('Pizza');
  await playerPage.getByRole('button', { name: 'Save' }).click();
  await expect(playerPage.getByText('Answers saved.')).toBeVisible();

  await adminPage.getByRole('button', { name: 'Remind pending players' }).click();
  await expect(adminPage.getByText('Everyone has already submitted. No reminders needed.')).toBeVisible();

  await adminContext.close();
  await playerContext.close();
});
