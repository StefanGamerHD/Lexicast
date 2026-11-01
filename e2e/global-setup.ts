import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Starts the real server on a fresh data directory and hands the setup token and outbox path to the tests.
export default async function globalSetup(): Promise<() => Promise<void>> {
  if (!existsSync('dist/web/index.html')) throw new Error('UI not built: run "npm run build:web" first');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lexicast-e2e-'));
  const server = spawn(process.execPath, ['src/main.ts'], {
    env: {
      ...process.env,
      LEXICAST_DATA_DIR: dir,
      LEXICAST_PORT: '8798',
      LEXICAST_BASE_URL: 'http://127.0.0.1:8798',
      LEXICAST_MAIL: 'file',
      LEXICAST_MAIL_FROM: 'Lexicast <noreply@example.com>',
      LEXICAST_AUTH_RATE_PER_MINUTE: '1000',
      LEXICAST_DIGEST_MINUTES: '0',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const token = await new Promise<string>((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`server did not print a setup token:\n${out}`)), 15_000);
    server.stdout!.on('data', (c: Buffer) => {
      out += c.toString();
      const m = /setup token[^\n]*\n([A-Za-z0-9_-]{20,})\n/.exec(out);
      if (m) { clearTimeout(timer); resolve(m[1]!); }
    });
    server.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}):\n${out}`)); });
  });
  process.env.E2E_SETUP_TOKEN = token;
  process.env.E2E_OUTBOX = path.join(dir, 'outbox');
  return async () => {
    server.kill('SIGTERM');
    await new Promise((r) => server.once('exit', r));
    await rm(dir, { recursive: true, force: true });
  };
}
