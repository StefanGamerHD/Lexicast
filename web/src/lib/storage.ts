// Per-browser conveniences only (language, theme before sign-in). Storage can be blocked; never rely on it.
export function load(key: string): string | null {
  try { return localStorage.getItem(`lexicast.${key}`); } catch { return null; }
}
export function save(key: string, value: string): void {
  try { localStorage.setItem(`lexicast.${key}`, value); } catch { /* ignore */ }
}
