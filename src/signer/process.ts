// Signer process: the ONLY place that loads the private signing key. The web process talks to it over IPC
// and never holds the key in its own memory. (Process separation; see README for the remaining limits.)
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const keyDir = process.argv[2];
if (!keyDir || !process.send) { console.error('signer must be started with a key directory and an IPC channel'); process.exit(2); }
const keyFile = path.join(keyDir, 'signing.pem');

let privateKey: KeyObject | null = null;

function load(): KeyObject {
  if (privateKey) return privateKey;
  if (!existsSync(keyFile)) {
    mkdirSync(keyDir!, { recursive: true, mode: 0o700 });
    const pair = generateKeyPairSync('ed25519');
    // 'wx': never overwrite an existing key
    writeFileSync(keyFile, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o400, flag: 'wx' });
    chmodSync(keyFile, 0o400);
  }
  privateKey = createPrivateKey(readFileSync(keyFile));
  return privateKey;
}

type Msg = { id: number; op: 'publicKey' | 'sign'; data?: string };

process.on('message', (m: Msg) => {
  try {
    const key = load();
    if (m.op === 'publicKey') {
      const jwk = createPublicKey(key).export({ format: 'jwk' });
      process.send!({ id: m.id, ok: true, data: jwk.x });
    } else if (m.op === 'sign') {
      const bytes = Buffer.from(m.data ?? '', 'base64');
      process.send!({ id: m.id, ok: true, data: sign(null, bytes, key).toString('base64') });
    } else {
      process.send!({ id: m.id, ok: false, error: 'unknown op' });
    }
  } catch (e) {
    process.send!({ id: m.id, ok: false, error: (e as Error).message });
  }
});
process.on('disconnect', () => process.exit(0));
