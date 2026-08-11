import { test, expect } from '@playwright/test';
import { uniqueEmail, uniqueUsername, signup } from './helpers.js';

test.setTimeout(30_000);

test('anonymous visitor who clicks an invite link signs up and lands directly in the game', async ({ browser }) => {
  const adminContext = await browser.newContext();
  const visitorContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const visitorPage = await visitorContext.newPage();

  const admin = { email: uniqueEmail('admin'), username: uniqueUsername('admin'), password: 'correct-horse-battery' };
  const visitor = { email: uniqueEmail('visitor'), username: uniqueUsername('visitor'), password: 'correct-horse-battery' };

  await signup(adminPage, admin);

  await adminPage.getByPlaceholder('Game name').fill('Invite Test Hive');
  await adminPage.getByPlaceholder('Game description').fill('A game for invite-link testing.');
  await adminPage.getByRole('button', { name: 'Create Game' }).click();
  await expect(adminPage).toHaveURL(/\/games\//);
  const gameId = new URL(adminPage.url()).pathname.split('/')[2];

  await adminPage.getByRole('tab', { name: 'Share' }).click();
  const inviteUrl = await adminPage.getByLabel('Invite link').inputValue();
  const invitePath = new URL(inviteUrl).pathname;

  // Visitor has never seen this game and is not signed in.
  await visitorPage.goto(invitePath);
  await expect(visitorPage).toHaveURL(/\/auth\?invite=/);

  await visitorPage.getByPlaceholder('Email').fill(visitor.email);
  await visitorPage.getByPlaceholder('Username (letters, numbers, underscore)').fill(visitor.username);
  await visitorPage.getByPlaceholder('Password', { exact: true }).fill(visitor.password);
  await visitorPage.getByPlaceholder('Confirm password').fill(visitor.password);
  await visitorPage.getByRole('button', { name: 'Sign up' }).click();

  await expect(visitorPage).toHaveURL(new RegExp(`/games/${gameId}$`));

  await adminContext.close();
  await visitorContext.close();
});
