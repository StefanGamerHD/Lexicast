// The hard rules of src/release/validate.ts, checked while typing. The server checks again on submit.
const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

export const placeholderNames = (text: string): string[] => [...text.matchAll(PLACEHOLDER)].map((m) => m[1]!);

export type TextProblem = 'empty' | 'too_long' | 'control' | 'bidi' | 'braces' | 'placeholders';

export function textProblems(text: string, source: string, maxLength: number | null): TextProblem[] {
  const p: TextProblem[] = [];
  if (!text.length) return ['empty'];
  if (text.length > (maxLength ?? 5000)) p.push('too_long');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) p.push('control');
  if (/[‪-‮⁦-⁩]/.test(text)) p.push('bidi');
  const found = placeholderNames(text).length;
  if ((text.match(/\{/g) ?? []).length !== found || (text.match(/\}/g) ?? []).length !== found) p.push('braces');
  else if (placeholderNames(text).sort().join(',') !== placeholderNames(source).sort().join(',')) p.push('placeholders');
  return p;
}
