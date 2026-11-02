import { expect, test, type Page } from '@playwright/test';
import { ADMIN, linkFromOutbox, signIn, watchCsp } from './helpers.ts';

// Runs after releases.spec.ts on the same instance: project "shop" (en, de), Ada owns it, Tom translates German.
test.describe.configure({ mode: 'serial' });

const TOM = { email: 'tom@example.com', password: 'e2e translating passphrase' };

async function asAdmin(page: Page) {
  await signIn(page, ADMIN.email, ADMIN.password);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}
const person = (page: Page, name: string) => page.getByTestId('member-list').getByRole('listitem').filter({ hasText: name }).first();

test('owner adds roles, invites and revokes; the last owner is protected', async ({ page, browser }) => {
  const noCsp = watchCsp(page);
  await asAdmin(page);
  await page.goto('/projects/shop');
  await page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: 'Members' }).click();
  await expect(page.getByRole('heading', { name: 'Members', exact: true })).toBeVisible();
  await expect(person(page, 'Tom Translator')).toContainText('Translator de');

  // an existing account gets the role at once
  await page.getByLabel('Email', { exact: true }).fill(TOM.email);
  await page.getByLabel('Role', { exact: true }).selectOption('reviewer');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('tom@example.com has the new role.');
  await expect(person(page, 'Tom Translator')).toContainText('Reviewer de');
  await person(page, 'Tom Translator').getByRole('button', { name: 'Remove role Reviewer de from Tom Translator' }).click();
  await expect(page.getByRole('status')).toContainText('Removed role Reviewer de from Tom Translator.');
  await expect(person(page, 'Tom Translator')).not.toContainText('Reviewer de');

  // unknown emails get an invitation, which can be revoked
  await page.getByLabel('Email', { exact: true }).fill('otto@example.com');
  await page.getByLabel('Role', { exact: true }).selectOption('translator');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Invitation sent by mail to otto@example.com.');
  const invites = page.getByTestId('invitation-list');
  await expect(invites).toContainText('otto@example.com');
  await expect(invites).toContainText('Translator de');
  const link = await linkFromOutbox('otto@example.com', 'invite');
  await invites.getByRole('listitem').filter({ hasText: 'otto@example.com' }).getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByRole('status')).toContainText('the link no longer works');
  await expect(page.getByText('No open invitations.')).toBeVisible();

  const ctx = await browser.newContext({ locale: 'en-GB' });
  const p = await ctx.newPage();
  await p.goto(link);
  await p.getByLabel('Display name').fill('Otto');
  await p.getByLabel('Password', { exact: true }).fill('e2e revoked passphrase');
  await p.getByLabel('Repeat password').fill('e2e revoked passphrase');
  await p.getByRole('button', { name: 'Create account' }).click();
  await expect(p.getByRole('alert')).toContainText('invalid, expired or already used');
  await ctx.close();

  // removing your own, last owner role: warned first, then refused by the server
  await person(page, ADMIN.name).getByRole('button', { name: `Remove role Owner from ${ADMIN.name}` }).click();
  await expect(page.getByText('You are removing your own owner role.')).toBeVisible();
  await page.getByRole('button', { name: 'Remove my owner role' }).click();
  await expect(page.getByRole('alert')).toHaveText('A project needs at least one owner. Make someone else owner first.');
  noCsp();
});

test('owner renames the project, switches the public page and adds a language with a fallback', async ({ page }) => {
  const noCsp = watchCsp(page);
  await asAdmin(page);
  await page.goto('/projects/shop/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

  await page.getByLabel('Project name').fill('Shop App');
  await page.getByLabel('Public progress page').check();
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByRole('status')).toHaveText('Settings saved.');
  await expect(page.getByRole('link', { name: 'Shop App' })).toBeVisible(); // breadcrumb follows the new name
  await page.goto('/progress/shop');
  await expect(page.getByRole('heading', { name: 'Shop App' })).toBeVisible();

  await page.goto('/projects/shop/settings');
  await page.getByLabel('Language tag').fill('de-AT');
  await page.getByLabel('Fallback chain').last().fill('fr');
  await page.getByRole('button', { name: 'Add language' }).click();
  await expect(page.getByRole('alert')).toHaveText('fr is not a language of this project.');
  await page.getByLabel('Fallback chain').last().fill('de, en');
  await page.getByRole('button', { name: 'Add language' }).click();
  await expect(page.getByRole('status')).toHaveText('Language de-AT added.');
  await expect(page.getByTestId('language-list')).toContainText('de-AT');
  await expect(page.getByLabel('Fallback chain').first()).toHaveValue(''); // de keeps its chain (source only, as created by the form)
  const r = await page.request.get('/api/v1/projects/shop');
  const langs = ((await r.json()) as { project: { languages: { tag: string; fallback: string[] }[] } }).project.languages;
  expect(langs.find((l) => l.tag === 'de-AT')!.fallback).toEqual(['de', 'en']);
  noCsp();
});

test('translators get neither members nor settings; phone width', async ({ browser, page }) => {
  const ctx = await browser.newContext({ locale: 'en-GB' });
  const tom = await ctx.newPage();
  await signIn(tom, TOM.email, TOM.password);
  await expect(tom.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  await tom.goto('/projects/shop');
  const nav = tom.getByRole('navigation', { name: 'Project sections' });
  await expect(nav.getByRole('link', { name: 'Members' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await tom.goto('/projects/shop/members');
  await expect(tom.getByRole('alert')).toHaveText('Only project owners manage members.');
  await ctx.close();

  await page.setViewportSize({ width: 360, height: 740 });
  await asAdmin(page);
  for (const path of ['/projects/shop/members', '/projects/shop/settings']) {
    await page.goto(path);
    await expect(page.locator('main h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(360);
  }
});
