import { expect, test, type Browser, type Page } from '@playwright/test';
import { ADMIN, linkFromOutbox, ORIGIN, signIn, watchCsp } from './helpers.ts';

// Runs after auth.spec.ts (same instance): the admin exists. Tom translates German, the admin (owner) reviews.
test.describe.configure({ mode: 'serial' });

const TOM = { email: 'tom@example.com', name: 'Tom Translator', password: 'e2e translating passphrase' };
const H = { headers: { Origin: ORIGIN } };

async function asTom(browser: Browser, options = {}): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ locale: 'en-GB', ...options });
  const page = await ctx.newPage();
  await signIn(page, TOM.email, TOM.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${TOM.name}` })).toBeVisible();
  return { page, close: () => ctx.close() };
}

test('owner creates a project with texts and invites a translator', async ({ page, browser }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  const created = await page.request.post('/api/v1/projects', { ...H, data: { slug: 'shop', name: 'Shop', sourceLanguage: 'en', languages: [{ tag: 'en' }, { tag: 'de', fallback: ['en'] }] } });
  expect(created.status()).toBe(201);
  const imported = await page.request.post('/api/v1/projects/shop/keys/import', { ...H, data: { apply: true, texts: { cart: { title: 'Your cart', items: '{count} items in your cart' }, checkout: 'Pay now' } } });
  expect(imported.status()).toBe(200);
  const invited = await page.request.post('/api/v1/projects/shop/members', { ...H, data: { email: TOM.email, role: 'translator', language: 'de' } });
  expect(invited.status()).toBe(201);

  const ctx = await browser.newContext({ locale: 'en-GB' });
  const p = await ctx.newPage();
  await p.goto(await linkFromOutbox(TOM.email, 'invite'));
  await p.getByLabel('Display name').fill(TOM.name);
  await p.getByLabel('Password', { exact: true }).fill(TOM.password);
  await p.getByLabel('Repeat password').fill(TOM.password);
  await p.getByRole('button', { name: 'Create account' }).click();
  await expect(p.getByRole('heading', { name: `Welcome, ${TOM.name}` })).toBeVisible();
  await expect(p.getByTestId('project-list')).toContainText('Translator de');
  await ctx.close();
});

test('translator: filters, placeholder check and chips, draft kept over reload, suggestions sent', async ({ browser }) => {
  const { page, close } = await asTom(browser);
  const noCsp = watchCsp(page);
  await page.getByRole('link', { name: 'Shop' }).click();
  await expect(page.getByRole('heading', { name: 'Shop' })).toBeVisible();
  await expect(page.getByText('0 of 3 translated')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open review queue' })).toHaveCount(0); // translators do not review
  await page.getByRole('link', { name: 'Translate' }).click();
  await expect(page.getByRole('heading', { name: /Translate: German/ })).toBeVisible();
  await expect(page.getByText('Showing 3 of 3')).toBeVisible();

  await page.getByLabel('Search').fill('cart');
  await expect(page.getByText('Showing 2 of 3')).toBeVisible();
  await page.getByRole('link', { name: /cart\.items/ }).click();
  await expect(page.getByTestId('source-text')).toHaveText('{count} items in your cart');

  const area = page.getByLabel(/Your translation/);
  await area.fill('Artikel im Warenkorb');
  await expect(page.getByText('The placeholders must be the same as in the source text.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send suggestion' })).toBeDisabled();
  await area.press('Home');
  await page.getByRole('button', { name: '{count}' }).click();
  await expect(area).toHaveValue('{count}Artikel im Warenkorb');
  await area.fill('{count} Artikel im Warenkorb');
  await expect(page.getByText('Draft saved in this browser')).toBeVisible();

  // the draft survives a reload and is only sent on submit
  await page.reload();
  await expect(page.getByLabel(/Your translation/)).toHaveValue('{count} Artikel im Warenkorb');
  await page.getByRole('button', { name: 'Send suggestion' }).click();
  await expect(page.getByRole('status')).toContainText('Suggestion sent');
  await expect(page.getByText('Your suggestion waits for review:')).toBeVisible();

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('source-text')).toHaveText('Your cart');
  await page.getByLabel(/Your translation/).fill('Warenkorb');
  await page.getByLabel(/Your translation/).press('Control+Enter');
  await expect(page.getByRole('status')).toContainText('Suggestion sent');

  await page.getByLabel('Search').fill('');
  await page.getByLabel('Show').selectOption('review');
  await expect(page.getByText('Showing 2 of 3')).toBeVisible();
  noCsp();
  await close();
});

test('owner reviews: diff, reject with a reason, approve; four-eyes for own texts', async ({ page }) => {
  const noCsp = watchCsp(page);
  await signIn(page, ADMIN.email, ADMIN.password);
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  await page.goto('/projects/shop');
  await expect(page.getByText('Suggestions waiting for your review: 2')).toBeVisible();
  await page.getByRole('link', { name: 'Open review queue' }).click();
  await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
  await expect(page.getByText('Open suggestions: 2')).toBeVisible();

  const title = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'cart.title' }) });
  await title.getByRole('button', { name: 'Reject…' }).click();
  await expect(title.getByRole('button', { name: 'Reject', exact: true })).toBeDisabled();
  await title.getByLabel('Reason for the author').fill('Please write "Dein Warenkorb".');
  await title.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Rejected: cart.title');

  const items = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'cart.items' }) });
  await expect(items.getByTestId('diff')).toHaveText('{count} Artikel im Warenkorb');
  await items.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('status')).toContainText('Approved: cart.items');
  await expect(page.getByText('Nothing to review. Well done.')).toBeVisible();

  // the owner's own suggestion needs another person (solo mode is off)
  const own = await page.request.post('/api/v1/projects/shop/suggestions', { ...H, data: { key: 'checkout', language: 'de', text: 'Jetzt bezahlen' } });
  expect(own.status()).toBe(201);
  await page.reload();
  await expect(page.getByText('Your own suggestion: another person must review it.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  await page.goto('/projects/shop');
  await expect(page.getByText('1 of 3 translated')).toBeVisible();
  noCsp();
});

test('translator sees the rejection reason and the approved text; phone width', async ({ browser }) => {
  const { page, close } = await asTom(browser, { viewport: { width: 360, height: 740 } });
  const noCsp = watchCsp(page);
  await page.goto('/projects/shop/translate/de');
  await expect(page.getByTestId('key-list')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.getByRole('link', { name: /cart\.title/ }).click();
  await expect(page.getByTestId('key-list')).toBeHidden(); // one pane at a time on phones
  await expect(page.getByRole('alert')).toContainText('Please write "Dein Warenkorb".');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.getByRole('link', { name: '← Back to the list' }).click();
  await page.getByRole('link', { name: /cart\.items/ }).click();
  await expect(page.getByText('Current translation')).toBeVisible();
  await expect(page.getByLabel(/Your translation/)).toHaveValue('{count} Artikel im Warenkorb');

  // the review queue is closed to translators
  await page.goto('/projects/shop/review');
  await expect(page.getByRole('alert')).toContainText('You do not review any language in this project.');
  noCsp();
  await close();
});
