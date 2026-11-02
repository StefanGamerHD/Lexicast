import { expect, test } from '@playwright/test';
import { ADMIN, linkFromOutbox, ORIGIN, signIn, watchCsp } from './helpers.ts';

test.describe.configure({ mode: 'serial' });

test('first visit leads to setup; wrong token is refused; setup shows the signing key', async ({ page }) => {
  const noCsp = watchCsp(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole('heading', { name: 'Set up Lexicast' })).toBeVisible();

  await page.getByLabel('Setup token').fill('wrong-token-wrong-token');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Display name').fill(ADMIN.name);
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByLabel('Repeat password').fill('other');
  await page.getByRole('button', { name: 'Create admin account' }).click();
  await expect(page.getByText('The password needs at least 12 characters.')).toBeVisible();
  await expect(page.getByText('The passwords do not match.')).toBeVisible();

  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByLabel('Repeat password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Create admin account' }).click();
  await expect(page.getByRole('alert')).toContainText('The setup token is wrong');

  await page.getByLabel('Setup token').fill(process.env.E2E_SETUP_TOKEN!);
  await page.getByRole('button', { name: 'Create admin account' }).click();
  await expect(page.getByRole('heading', { name: 'Lexicast is ready' })).toBeVisible();
  await expect(page.getByTestId('fingerprint')).toContainText('SHA256:');
  await expect(page.getByTestId('public-key')).not.toBeEmpty();

  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${ADMIN.name}` })).toBeVisible();
  noCsp();
});

test('setup page is closed once the instance is set up', async ({ page }) => {
  await page.goto('/setup');
  await expect(page).toHaveURL(/\/login$/);
});

test('sign-in: wrong password, then success with return path', async ({ page }) => {
  const noCsp = watchCsp(page);
  await page.goto('/projects');
  await expect(page).toHaveURL(/\/login\?next=%2Fprojects$/);
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill('not the right password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email or password is wrong.');

  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('heading', { name: 'Your projects' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  noCsp();
});

test('an invited person creates an account from the mailed link', async ({ page, browser }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  const r = await page.request.post('/api/v1/invitations', { data: { email: 'tina@example.com' }, headers: { Origin: ORIGIN } });
  expect(r.status()).toBe(201);
  const link = await linkFromOutbox('tina@example.com', 'invite');

  const other = await browser.newContext({ locale: 'en-GB' });
  const p = await other.newPage();
  const noCsp = watchCsp(p);
  await p.goto(link);
  await expect(p.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await p.getByLabel('Display name').fill('Tina Translator');
  await p.getByLabel('Password', { exact: true }).fill('e2e invited passphrase');
  await p.getByLabel('Repeat password').fill('e2e invited passphrase');
  await p.getByRole('button', { name: 'Create account' }).click();
  await expect(p.getByRole('heading', { name: 'Welcome, Tina Translator' })).toBeVisible();

  // the link works once
  await p.getByRole('button', { name: 'Sign out' }).click();
  await p.goto(link);
  await p.getByLabel('Display name').fill('Again');
  await p.getByLabel('Password', { exact: true }).fill('e2e invited passphrase');
  await p.getByLabel('Repeat password').fill('e2e invited passphrase');
  await p.getByRole('button', { name: 'Create account' }).click();
  await expect(p.getByRole('alert')).toContainText('invalid, expired or already used');
  noCsp();
  await other.close();
});

test('password reset by mail', async ({ page }) => {
  const noCsp = watchCsp(page);
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page).toHaveURL(/\/forgot$/);
  await page.getByLabel('Email').fill('tina@example.com');
  await page.getByRole('button', { name: 'Send link' }).click();
  await expect(page.getByRole('status')).toContainText('If an account with this email exists');

  await page.goto(await linkFromOutbox('tina@example.com', 'reset'));
  await page.getByLabel('New password').fill('e2e invited newphrase 2');
  await page.getByLabel('Repeat password').fill('e2e invited newphrase 2');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByRole('status')).toContainText('Your password was changed');

  await signIn(page, 'tina@example.com', 'e2e invited passphrase');
  await expect(page.getByRole('alert')).toHaveText('Email or password is wrong.');
  await signIn(page, 'tina@example.com', 'e2e invited newphrase 2');
  await expect(page.getByRole('heading', { name: 'Welcome, Tina Translator' })).toBeVisible();
  noCsp();
});

test('German from the browser language, saved per account; dark theme switch', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'de-DE', colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');

  await page.getByLabel('E-Mail').fill('tina@example.com');
  await page.getByLabel('Passwort', { exact: true }).fill('e2e invited newphrase 2');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  // Tina's account was created in English: the account's choice wins after sign-in
  await expect(page.getByRole('heading', { name: 'Welcome, Tina Translator' })).toBeVisible();
  await page.getByLabel('Language').selectOption('de');
  await expect(page.getByRole('heading', { name: 'Willkommen, Tina Translator' })).toBeVisible();
  await page.getByLabel('Darstellung').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(28, 25, 23)');

  // a fresh browser gets the saved account choice back
  const ctx2 = await browser.newContext({ locale: 'en-GB' });
  const p2 = await ctx2.newPage();
  await p2.goto('/login');
  await p2.getByLabel('Email').fill('tina@example.com');
  await p2.getByLabel('Password', { exact: true }).fill('e2e invited newphrase 2');
  await p2.getByRole('button', { name: 'Sign in' }).click();
  await expect(p2.getByRole('heading', { name: 'Willkommen, Tina Translator' })).toBeVisible();
  await expect(p2.locator('html')).toHaveAttribute('data-theme', 'dark');
  await ctx.close();
  await ctx2.close();
});

test('phone width: no horizontal scrolling', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'de-DE' });
  const page = await ctx.newPage();
  for (const p of ['/login', '/forgot', '/reset/abcdefghijklmnopqrstuvwxyz012345']) {
    await page.goto(p);
    await expect(page.locator('main h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), p).toBeLessThanOrEqual(360);
  }
  await ctx.close();
});
