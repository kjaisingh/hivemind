import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: null }) }),
  );
});

test('landing and authentication remain usable without horizontal overflow', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'How well do you know your group?' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create or join a game' })).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundImage)).toBe('none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.goto('/auth');
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign up' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
});

test('theme control works when browser storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage unavailable', 'SecurityError');
      },
    });
  });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: /Switch to (light|dark) mode/ });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toBeVisible();
});

test('results offer an answer-summary download at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.unroute('**/api/auth/me');
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: { id: 'user-1', username: 'Player' } }),
  }));
  await page.route('**/api/games/game-1/rounds/round-1/results', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      round: {
        id: 'round-1', gameName: 'Game', name: 'Round',
        ownScore: { totalScore: 2, rank: 1, medalAwarded: true },
        leaderboard: [],
        questions: [{
          id: 'question-1', prompt: 'Favorite snack?', yourAnswer: 'Taco', yourNormalizedAnswer: 'taco',
          stats: [{ id: 'stat-1', displayAnswer: 'Taco', normalizedAnswer: 'taco', count: 2, percentage: 100 }],
        }],
      },
    }),
  }));

  await page.goto('/games/game-1/rounds/round-1/results');
  await expect(page.getByRole('heading', { name: 'Game: Round' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download answer summary' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('hivemind-round-1-answers.csv');
});

test('a delayed results response cannot replace the current round', async ({ page }) => {
  await page.unroute('**/api/auth/me');
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ user: { id: 'user-1', username: 'Player' } }),
  }));

  let releaseFirst;
  let firstRequestStarted;
  const firstRequest = new Promise((resolve) => { firstRequestStarted = resolve; });
  await page.route('**/api/games/game-1/rounds/*/results', async (route) => {
    const first = route.request().url().includes('/round-1/');
    if (first) {
      firstRequestStarted();
      await new Promise((resolve) => { releaseFirst = resolve; });
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ round: {
        id: first ? 'round-1' : 'round-2', gameName: 'Game', name: first ? 'Old round' : 'New round',
        ownScore: { totalScore: 0, rank: 1 }, leaderboard: [], questions: [],
      } }),
    });
  });

  await page.goto('/games/game-1/rounds/round-1/results');
  await firstRequest;
  await page.evaluate(() => {
    window.history.pushState(null, '', '/games/game-1/rounds/round-2/results');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('heading', { name: 'Game: New round' })).toBeVisible();
  releaseFirst();
  await expect(page.getByRole('heading', { name: 'Game: Old round' })).toHaveCount(0);
});
