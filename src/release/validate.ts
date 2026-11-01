const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

export function placeholders(text: string): string {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]).sort().join(',');
}

// Hard validation rules (functional-plan.md section 6). Throws with a message naming the key.
export function validateText(key: string, text: unknown, source?: string): asserts text is string {
  if (typeof text !== 'string') throw new Error(`${key}: value is not a string`);
  if (text.length === 0) throw new Error(`${key}: empty text`);
  if (text.length > 5000) throw new Error(`${key}: longer than 5000 characters`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error(`${key}: control characters`);
  if (/[‪-‮⁦-⁩]/.test(text)) throw new Error(`${key}: bidirectional override characters`);
  if (text !== text.normalize('NFC')) throw new Error(`${key}: not NFC normalized`);
  const open = (text.match(/\{/g) || []).length;
  const close = (text.match(/\}/g) || []).length;
  const found = [...text.matchAll(PLACEHOLDER)].length;
  if (open !== found || close !== found) throw new Error(`${key}: malformed braces`);
  if (source !== undefined && placeholders(text) !== placeholders(source)) {
    throw new Error(`${key}: placeholders differ from the source text`);
  }
}

const TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
export const isLanguageTag = (s: string): boolean => TAG.test(s);
export const isProjectSlug = (s: string): boolean => /^[a-z0-9][a-z0-9-]{0,62}$/.test(s);
