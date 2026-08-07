import { expect } from '@playwright/test';

export function uniqueEmail(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1e6)}@example.com`;
}

export function uniqueUsername(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1e6)}`.slice(0, 24);
}

export async function signup(page, { email, username, password }) {
  await page.goto('/auth');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Username (letters, numbers, underscore)').fill(username);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

export async function login(page, { email, password }) {
  await page.goto('/auth');
  await page.getByRole('button', { name: 'Already have an account? Login' }).click();
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

export function toDatetimeLocal(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
