import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const N = 2 ** 15, R = 8, P = 1, KEYLEN = 32;
const OPTS = { N, r: R, p: P, maxmem: 128 * N * R * 2 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password.normalize('NFKC'), salt, KEYLEN, OPTS);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const got = await scryptAsync(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2 });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// Used when the account does not exist, so response time does not reveal which emails are registered.
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));

export const newToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('base64url');

export function passwordProblem(password: unknown, email: string): string | null {
  if (typeof password !== 'string') return 'password must be a string';
  if (password.length < 12) return 'password must have at least 12 characters';
  if (password.length > 256) return 'password must have at most 256 characters';
  const name = email.split('@')[0] ?? '';
  if (name.length >= 4 && password.toLowerCase().includes(name)) return 'password must not contain your email name';
  return null;
}

export function normalizeEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}
