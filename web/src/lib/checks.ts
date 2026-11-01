// Client-side checks mirror the server's rules (src/auth/crypto.ts); the server stays the authority.
export const MIN_PASSWORD = 12;
export const passwordPairOk = (password: string, confirm: string): boolean => password.length >= MIN_PASSWORD && password.length <= 256 && password === confirm;
