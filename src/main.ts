import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createApp } from './app.ts';
import { createAuth } from './auth/service.ts';
import { loadConfig } from './config.ts';
import { migrate, openDatabase } from './db/migrate.ts';
import { createMailer } from './mail/mailer.ts';
import { createOutbound } from './mail/outbound.ts';
import { createDigest } from './notify/service.ts';
import { startSigner } from './signer/client.ts';

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
mkdirSync(path.join(config.dataDir, 'releases'), { recursive: true, mode: 0o755 });
mkdirSync(config.keyDir, { recursive: true, mode: 0o700 });
const db = openDatabase(path.join(config.dataDir, 'lexicast.sqlite'));
const schema = migrate(db);
const auth = createAuth(db);
const signer = startSigner(config.keyDir);
const mailer = createMailer(config.mail);
const server = createApp({ config, db, auth, signer, mailer });
const digest = createDigest(db, mailer, createOutbound(mailer, config));
let digestTimer: NodeJS.Timeout | undefined;
if (mailer.enabled && config.mail.digestMinutes > 0) {
  digestTimer = setInterval(() => { digest().catch((e: Error) => console.error('digest failed:', e.message)); }, config.mail.digestMinutes * 60_000);
  digestTimer.unref();
}

const setupToken = auth.issueSetupToken();
server.listen(config.port, config.host, () => {
  console.log(`lexicast listening on ${config.host}:${config.port} (schema ${schema}), base url ${config.baseUrl}, mail ${mailer.mode}`);
  if (setupToken) {
    console.log('Instance is not set up yet. One-time setup token (valid until restart or setup):');
    console.log(setupToken);
  }
});

const shutdown = () => { clearInterval(digestTimer); signer.close(); server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(1), 10_000).unref(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
