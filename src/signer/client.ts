import { fork, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';

export interface Signer {
  /** Raw Ed25519 public key, base64url (what apps embed). */
  publicKey(): Promise<string>;
  sign(bytes: Buffer): Promise<Buffer>;
  close(): void;
}

export function fingerprint(publicKeyB64u: string): string {
  return 'SHA256:' + createHash('sha256').update(Buffer.from(publicKeyB64u, 'base64url')).digest('base64url');
}

export function startSigner(keyDir: string): Signer {
  const child: ChildProcess = fork(new URL('./process.ts', import.meta.url), [keyDir], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const pending = new Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>();
  let nextId = 1;
  let closed = false;

  child.on('message', (m: { id: number; ok: boolean; data?: string; error?: string }) => {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.data ?? ''); else p.reject(new Error(`signer: ${m.error}`));
  });
  child.on('exit', () => {
    closed = true;
    for (const p of pending.values()) p.reject(new Error('signer process exited'));
    pending.clear();
  });
  child.unref();
  child.channel?.unref();

  const call = (op: 'publicKey' | 'sign', data?: string): Promise<string> =>
    new Promise((resolve, reject) => {
      if (closed) return reject(new Error('signer process not running'));
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('signer timeout')); }, 10_000);
      pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      child.send({ id, op, data });
    });

  return {
    publicKey: () => call('publicKey'),
    sign: async (bytes) => Buffer.from(await call('sign', bytes.toString('base64')), 'base64'),
    close: () => { if (!closed) child.kill(); },
  };
}
