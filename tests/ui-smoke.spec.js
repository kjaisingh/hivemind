import { expect, test } from '@playwright/test';

async function mockGame(page, overrides = {}) {
  const game = {
    id: 'game-1', name: 'Test Hive', description: 'Friends playing together', code: 'ABC-234',
    role: 'PLAYER', emailConfigured: false, leaderboard: [], pastRounds: [], draftRounds: [],
    activeRound: {
      id: 'round-1', name: 'Snack round', expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      questions: [{ id: 'question-1', prompt: 'Favorite snack?', type: 'TEXT' }],
      answers: [{ questionId: 'question-1', rawAnswer: 'Chips' }],
    },
    ...overrides,
  };
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user: { id: 'user-1', username: 'Player' } } }));
  await page.route('**/api/games/game-1', (route) => route.fulfill({ json: { game } }));
  await page.route('**/api/games/game-1/rounds/*/progress', (route) => route.fulfill({ json: { submittedCount: 1, totalCount: 3 } }));
  await page.route('**/api/games/game-1/suggestions', (route) => route.fulfill({ json: { suggestions: [] } }));
  return game;
}

test('discard restores saved answers and cancellation preserves edits', async ({ page }) => {
  await mockGame(page);
  await page.goto('/games/game-1');
  const answer = page.getByRole('textbox', { name: 'Favorite snack?' });
  await answer.fill('Pizza');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('tab', { name: 'Season Leaderboard', exact: true }).click();
  await expect(answer).toHaveValue('Pizza');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('tab', { name: 'Season Leaderboard', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Season Leaderboard', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Active Round' }).click();
  await expect(answer).toHaveValue('Chips');
  await expect(page.getByRole('button', { name: 'Save Answers' })).toBeDisabled();
});

test('visible refresh discovers rounds and preserves unsaved answers and host settings', async ({ page }) => {
  const game = await mockGame(page, {
    role: 'ADMIN', activeRound: null,
    emailSettings: { autoRoundOpen: true, autoResultsLive: true, expiringHoursCsv: '24,1' },
  });
  await page.goto('/games/game-1');
  await expect(page.getByText(/No active round/)).toBeVisible();
  game.activeRound = {
    id: 'round-new', name: 'Fresh round', expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    questions: [{ id: 'question-1', prompt: 'Favorite snack?', type: 'TEXT' }], answers: [],
  };
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'Fresh round' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Favorite snack?' }).fill('Unsaved pizza');
  game.name = 'Updated hive';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'Updated hive', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Favorite snack?' })).toHaveValue('Unsaved pizza');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('tab', { name: 'Manage Game' }).click();
  await page.getByLabel('Round open emails').uncheck();
  await page.getByLabel('Round name', { exact: true }).fill('My next round');
  game.name = 'Refreshed again';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'Refreshed again', exact: true })).toBeVisible();
  await expect(page.getByLabel('Round open emails')).not.toBeChecked();
  await expect(page.getByLabel('Round name', { exact: true })).toHaveValue('My next round');
});

test('dashboard action failures keep loaded games visible', async ({ page }) => {
  await mockGame(page);
  await page.route('**/api/dashboard', (route) => route.fulfill({ json: { games: [{
    id: 'game-1', name: 'Existing hive', description: 'Still here', code: 'ABC-234', role: 'PLAYER',
    hasPendingSubmission: false, recentClosedRounds: [],
  }] } }));
  await page.route('**/api/games/join', (route) => route.fulfill({ status: 404, json: { message: 'Game code not found.' } }));
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: /Existing hive/ })).toBeVisible();
  await page.getByLabel('Game code').fill('XYZ-234');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Game code not found.');
  await expect(page.getByRole('button', { name: /Existing hive/ })).toBeVisible();
});

test('long game content fits narrow screens in dark mode', async ({ page }) => {
  await mockGame(page, { name: 'LongName'.repeat(10), description: 'Description'.repeat(20) });
  await page.goto('/games/game-1');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: null }) }),
  );
});

test('session lookup failures can retry without redirecting to signup', async ({ page }) => {
  await mockGame(page);
  await page.route('**/api/auth/me', (route) => route.fulfill({ status: 503, json: { message: 'Server waking up.' } }));
  await page.goto('/games/game-1');
  await expect(page.getByRole('alert')).toContainText('Server waking up.');
  await expect(page).toHaveURL(/\/games\/game-1$/);
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user: { id: 'user-1', username: 'Player' } } }));
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Test Hive', exact: true })).toBeVisible();
});

test('expired sessions return to authentication with the current destination', async ({ page }) => {
  await mockGame(page);
  await page.goto('/games/game-1');
  await page.getByRole('textbox', { name: 'Favorite snack?' }).fill('Pizza');
  await page.route('**/api/games/game-1/active-round/save', (route) => route.fulfill({
    status: 401, json: { message: 'Authentication required.' },
  }));
  await page.getByRole('button', { name: 'Save Answers' }).click();
  await expect(page).toHaveURL(/\/auth\?next=/);
  expect(new URL(page.url()).searchParams.get('next')).toContain('/games/game-1');
});

test('an old invite response cannot redirect away from the current invite', async ({ page }) => {
  let releaseOld;
  const gate = new Promise((resolve) => { releaseOld = resolve; });
  let started;
  const oldStarted = new Promise((resolve) => { started = resolve; });
  await page.route('**/api/join/old', async (route) => {
    started();
    await gate;
    await route.fulfill({ json: { requiresAuth: true } });
  });
  await page.route('**/api/join/new', (route) => route.fulfill({ json: { requiresAuth: true } }));
  await page.goto('/join/old');
  await oldStarted;
  await page.evaluate(() => {
    window.history.pushState(null, '', '/join/new');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page).toHaveURL(/\/auth\?invite=new$/);
  releaseOld();
  await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible();
  await expect(page).toHaveURL(/\/auth\?invite=new$/);
});

test('signup keeps the new session when joining an invitation fails', async ({ page }) => {
  await page.route('**/api/auth/signup', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ user: { id: 'user-1', username: 'Player' }, pendingInviteToken: 'missing' }),
  }));
  await page.route('**/api/join/missing', (route) => route.fulfill({
    status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Invite link is invalid.' }),
  }));
  await page.goto('/auth?invite=missing');
  await page.getByLabel('Email').fill('player@example.com');
  await page.getByLabel('Username').fill('Player');
  await page.getByLabel('Password', { exact: true }).fill('test-password');
  await page.getByLabel('Confirm password').fill('test-password');
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await expect(page).toHaveURL(/\/join\/missing$/);
  await expect(page.getByRole('alert')).toHaveText('Invite link is invalid.');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create account' })).toHaveCount(0);
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
