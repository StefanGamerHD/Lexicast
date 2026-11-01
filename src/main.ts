import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { migrate, openDatabase } from './db/migrate.ts';

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
mkdirSync(path.join(config.dataDir, 'releases'), { recursive: true, mode: 0o755 });
const db = openDatabase(path.join(config.dataDir, 'lexicast.sqlite'));
const schema = migrate(db);
const server = createApp(config, db);
server.listen(config.port, config.host, () => console.log(`lexicast listening on ${config.host}:${config.port} (schema ${schema})`));

const shutdown = () => { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(1), 10_000).unref(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
