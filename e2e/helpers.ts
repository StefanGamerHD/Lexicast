import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';

export const ADMIN = { email: 'admin@example.com', name: 'Ada Admin', password: 'e2e owner passphrase 1' };
export const ORIGIN = 'http://127.0.0.1:8798';

// Newest mail to this address whose text contains a link of the given kind, from the file transport.
export async function linkFromOutbox(to: string, kind: 'invite' | 'reset'): Promise<string> {
  const dir = process.env.E2E_OUTBOX!;
  for (let i = 0; i < 50; i++) {
    const files = (await readdir(dir).catch(() => [] as string[])).sort().reverse();
    for (const f of files) {
      const mail = JSON.parse(await readFile(path.join(dir, f), 'utf8')) as { to: string; text: string };
      const m = new RegExp(`https?://[^\\s]+/${kind}/[A-Za-z0-9_-]+`).exec(mail.text);
      if (mail.to.includes(to) && m) return new URL(m[0]).pathname;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no ${kind} mail for ${to}`);
}

// Fails the test on any CSP violation the browser reports.
export function watchCsp(page: Page): () => void {
  const violations: string[] = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to (load|execute|apply)/i.test(m.text())) violations.push(m.text()); });
  return () => expect(violations, 'CSP violations').toEqual([]);
}

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
