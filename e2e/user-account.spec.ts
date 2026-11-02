import { expect, test, type Browser, type Page } from '@playwright/test';
import { ADMIN, signIn, watchCsp } from './helpers.ts';

// Runs last on the same instance: project "shop" exists, Ada (admin) owns it, Tom translates German.
test.describe.configure({ mode: 'serial' });

const TOM = { email: 'tom@example.com', name: 'Tom Translator', password: 'e2e translating passphrase' };

async function signedIn(browser: Browser, who: { email: string; password: string }): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ locale: 'en-GB' });
  const page = await ctx.newPage();
  await signIn(page, who.email, who.password);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  return { page, close: () => ctx.close() };
}

test('account page: display name, notifications and language are saved in the account', async ({ page }) => {
  const noCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.getByRole('link', { name: `Account: ${ADMIN.name}` }).click();
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  await expect(page.getByTestId('account-email')).toHaveText(ADMIN.email);

  const save = page.getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();
  await page.getByLabel('Display name').fill('Ada Lovelace');
  await page.getByLabel('Email notifications').uncheck();
  await save.click();
  await expect(page.getByRole('status')).toContainText('Profile saved.');
  await expect(page.getByRole('link', { name: 'Account: Ada Lovelace' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Display name')).toHaveValue('Ada Lovelace');
  await expect(page.getByLabel('Email notifications')).not.toBeChecked();

  // language applies at once and follows the account
  await page.getByLabel('Language', { exact: true }).last().selectOption('de');
  await expect(page.getByRole('heading', { name: 'Dein Konto' })).toBeVisible();
  await page.getByLabel('Sprache', { exact: true }).last().selectOption('en');
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();

  await page.getByLabel('Display name').fill(ADMIN.name);
  await page.getByLabel('Email notifications').check();
  await save.click();
  await expect(page.getByRole('link', { name: `Account: ${ADMIN.name}` })).toBeVisible();
  noCsp();
});

test('password change needs the current password and signs out other sessions', async ({ browser }) => {
  const a = await signedIn(browser, TOM);
  const b = await signedIn(browser, TOM);
  const noCsp = watchCsp(a.page);
  await a.page.goto('/account');
  const form = a.page.getByRole('region', { name: 'Change password' });
  await form.getByLabel('Current password').fill('not my password at all');
  await form.getByLabel('New password').fill('e2e changed passphrase');
  await form.getByLabel('Repeat password').fill('e2e changed passphrase');
  await form.getByRole('button', { name: 'Change password' }).click();
  await expect(form.getByRole('alert')).toContainText('The current password is wrong.');

  await form.getByLabel('Current password').fill(TOM.password);
  await form.getByRole('button', { name: 'Change password' }).click();
  await expect(form.getByRole('status')).toContainText('All your other sessions were signed out.');
  await expect(form.getByLabel('Current password')).toHaveValue('');

  // this session stays, the other one is gone
  await a.page.reload();
  await expect(a.page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  await b.page.reload();
  await expect(b.page).toHaveURL(/\/login/);
  await signIn(b.page, TOM.email, 'e2e changed passphrase');
  await expect(b.page.getByRole('heading', { name: `Welcome, ${TOM.name}` })).toBeVisible();
  noCsp();
  await a.close(); await b.close();
});

test('only the instance admin creates projects; a taken short name is reported', async ({ page, browser }) => {
  const tom = await signedIn(browser, { email: TOM.email, password: 'e2e changed passphrase' });
  await expect(tom.page.getByRole('link', { name: 'New project' })).toHaveCount(0);
  await tom.page.goto('/projects/new');
  await expect(tom.page.getByText('Only the instance admin can create projects.')).toBeVisible();
  await tom.close();

  await signIn(page, ADMIN.email, ADMIN.password);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  await page.goto('/projects/new');
  await page.getByLabel('Project name').fill('Shop');
  await page.getByLabel('Target languages').fill('de');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText('A project with this short name already exists.')).toBeVisible();
  await page.getByLabel('Short name (slug)').fill('new');
  await expect(page.getByText('This short name is reserved.')).toBeVisible();
  await page.getByLabel('Short name (slug)').fill('shop-two');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL('/projects/shop-two');
});
