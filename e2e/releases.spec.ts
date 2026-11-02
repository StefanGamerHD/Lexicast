import { expect, test, type Page } from '@playwright/test';
import { ADMIN, ORIGIN, signIn, watchCsp } from './helpers.ts';

// Runs after projects.spec.ts on the same instance: project "shop" with 3 keys, German "cart.items" approved, Tom translates German.
test.describe.configure({ mode: 'serial' });

const TOM = { email: 'tom@example.com', password: 'e2e translating passphrase' };

async function asAdmin(page: Page) {
  await signIn(page, ADMIN.email, ADMIN.password);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}
const manifest = async (page: Page) => (await (await page.request.get('/p/shop/manifest.json')).json()) as { release: number; languages: Record<string, { path: string }> };

test('owner imports JSON with a preview and creates a key', async ({ page }) => {
  const noCsp = watchCsp(page);
  await asAdmin(page);
  await page.goto('/projects/shop');
  await page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: 'Keys' }).click();
  await expect(page.getByRole('heading', { name: 'Keys', exact: true })).toBeVisible();
  await expect(page.getByText('Showing 3 of 3')).toBeVisible();

  await page.getByRole('link', { name: 'Import JSON' }).click();
  await page.getByLabel('Or paste JSON').fill('{\n  "cart": {\n    "title": "Your cart",\n  }\n}');
  await page.getByRole('button', { name: 'Show preview' }).click();
  await expect(page.getByRole('alert')).toContainText('error in line 4, column 3');

  await page.getByLabel('Or paste JSON').fill(JSON.stringify({ cart: { title: 'Your cart', items: '{count} items in your cart' }, checkout: 'Pay now', account: { greeting: 'Hello {name}!' } }, null, 2));
  await page.getByRole('button', { name: 'Show preview' }).click();
  const preview = page.getByTestId('import-preview');
  await expect(preview).toContainText('New keys: 1');
  await expect(preview).toContainText('Unchanged: 3');
  await preview.getByText('New keys (1)').click();
  await expect(preview).toContainText('account.greeting');
  await preview.getByRole('button', { name: 'Apply import' }).click();
  await expect(page.getByRole('status')).toContainText('Import applied: 1 new, 0 changed');

  await page.getByRole('link', { name: 'Go to the keys' }).click();
  await page.getByRole('button', { name: 'New key' }).click();
  await page.getByLabel('Key name').fill('footer legal');
  await page.getByLabel('Source text (en)').fill('All rights {reserved');
  await page.getByRole('button', { name: 'Create key' }).click();
  await expect(page.getByText('Use letters, digits, dot, dash and underscore')).toBeVisible();
  await expect(page.getByText('Curly braces may only be used for placeholders')).toBeVisible();
  await page.getByLabel('Key name').fill('cart.title');
  await page.getByLabel('Source text (en)').fill('All rights reserved.');
  await page.getByRole('button', { name: 'Create key' }).click();
  await expect(page.getByRole('alert')).toHaveText('A key with this name already exists.');
  await page.getByLabel('Key name').fill('footer.legal');
  await page.getByRole('button', { name: 'Create key' }).click();
  await expect(page.getByRole('status')).toContainText('Key footer.legal was created.');
  await expect(page.getByText('Showing 5 of 5')).toBeVisible();
  noCsp();
});

test('owner publishes a release; the signed files are delivered with fallbacks', async ({ page }) => {
  const noCsp = watchCsp(page);
  await asAdmin(page);
  await page.goto('/projects/shop/releases');
  const preview = page.getByTestId('release-preview');
  await expect(preview.getByRole('heading', { name: 'Next release: 1' })).toBeVisible();
  await expect(preview).toContainText('Suggestions still waiting for review (not included): 1');
  await page.getByLabel('Note (optional)').fill('First release');
  await page.getByRole('button', { name: 'Publish release 1' }).click();
  await expect(page.getByRole('status')).toContainText('Release 1 is live');
  await expect(page.getByTestId('release-history')).toContainText('First release');
  await expect(preview).toContainText('Nothing changed since the live release.');
  await expect(page.getByRole('button', { name: 'Publish release 2' })).toBeDisabled();

  const m = await manifest(page);
  expect(m.release).toBe(1);
  const de = (await (await page.request.get(`/p/shop/${m.languages.de!.path}`)).json()) as Record<string, string>;
  expect(de['cart.items']).toBe('{count} Artikel im Warenkorb');
  expect(de['footer.legal']).toBe('All rights reserved.'); // fallback to the source language
  noCsp();
});

test('changing a source text marks translations outdated; rollback publishes the old content as a new release', async ({ page }) => {
  const noCsp = watchCsp(page);
  await asAdmin(page);
  await page.goto('/projects/shop/keys');
  await page.getByRole('link', { name: /cart\.items/ }).click();
  await expect(page.getByRole('heading', { name: 'cart.items' })).toBeVisible();
  await page.getByLabel('Source text (en)').fill('{count} products in your cart');
  await expect(page.getByText('marks 1 translation(s) as outdated')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toContainText('now marked as outdated');
  await expect(page.getByTestId('key-translations')).toContainText('Outdated');

  await page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: 'Releases' }).click();
  await expect(page.getByTestId('release-preview')).toContainText('Outdated translations left out: 1');
  await page.getByRole('button', { name: 'Publish release 2' }).click();
  await expect(page.getByRole('status')).toContainText('Release 2 is live');

  await page.getByRole('button', { name: 'Restore release 1…' }).click();
  await page.getByRole('button', { name: 'Restore release 1', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Release 3 is live with the content of release 1');
  const history = page.getByTestId('release-history');
  await expect(history.getByRole('listitem').filter({ hasText: 'Release 3' })).toContainText('Restores the content of release 1.');
  await expect(history.getByRole('listitem').filter({ hasText: 'Release 2' })).toContainText('Rolled back');
  const m = await manifest(page);
  expect(m.release).toBe(3);
  const de = (await (await page.request.get(`/p/shop/${m.languages.de!.path}`)).json()) as Record<string, string>;
  expect(de['cart.items']).toBe('{count} Artikel im Warenkorb');
  noCsp();
});

test('translators see the history but not the owner screens; phone width', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'en-GB', viewport: { width: 360, height: 740 } });
  const page = await ctx.newPage();
  const noCsp = watchCsp(page);
  await signIn(page, TOM.email, TOM.password);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  await page.goto('/projects/shop/releases');
  await expect(page.getByTestId('release-history')).toContainText('Release 3');
  await expect(page.getByTestId('release-preview')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Restore release/ })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: 'Keys' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.goto('/projects/shop/keys');
  await expect(page.getByRole('alert')).toHaveText('Only project owners manage keys.');
  const r = await page.request.post('/api/v1/projects/shop/releases', { data: {}, headers: { Origin: ORIGIN } });
  expect(r.status()).toBe(403);
  noCsp();
  await ctx.close();
});
