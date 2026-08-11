import { test, expect } from '@playwright/test';
import { uniqueEmail, uniqueUsername, signup, login } from './helpers.js';

test('signup creates an account and lands on the dashboard', async ({ page }) => {
  const email = uniqueEmail('signup');
  const username = uniqueUsername('signup');

  await signup(page, { email, username, password: 'correct-horse-battery' });

  await expect(page.getByRole('heading', { name: `Welcome, ${username}` })).toBeVisible();
});

test('duplicate email is rejected with an error message', async ({ page }) => {
  const email = uniqueEmail('dup');
  const username = uniqueUsername('dup');
  await signup(page, { email, username, password: 'correct-horse-battery' });

  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/$|\/auth/);

  await page.goto('/auth');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Username (letters, numbers, underscore)').fill(uniqueUsername('dup2'));
  await page.getByPlaceholder('Password', { exact: true }).fill('another-password');
  await page.getByPlaceholder('Confirm password').fill('another-password');
  await page.getByRole('button', { name: 'Sign up' }).click();

  await expect(page.locator('.error')).toBeVisible();
  await expect(page).toHaveURL(/\/auth/);
});

test('login with existing credentials, logout, and session survives reload', async ({ page }) => {
  const email = uniqueEmail('login');
  const username = uniqueUsername('login');
  const password = 'correct-horse-battery';

  await signup(page, { email, username, password });
  await page.getByRole('button', { name: 'Logout' }).click();

  await login(page, { email, password });
  await expect(page.getByRole('heading', { name: `Welcome, ${username}` })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: `Welcome, ${username}` })).toBeVisible();

  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/$|\/auth/);

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/auth\?next=/);
});
