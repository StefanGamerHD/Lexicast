// Soft checks: shown to the reviewer, never block a suggestion (functional-plan.md section 6).
export type Warning = 'much_longer' | 'much_shorter' | 'whitespace_differs' | 'punctuation_differs' | 'same_as_source' | 'new_url_or_email' | 'looks_like_markup';

const URL_OR_EMAIL = /https?:\/\/[^\s]+|[^\s@]+@[^\s@]+\.[^\s@]+/g;
const END_PUNCT = /[.!?:;…]$/;

export function softWarnings(text: string, source: string): Warning[] {
  const w: Warning[] = [];
  if (source.length >= 8 && text.length > source.length * 2.5) w.push('much_longer');
  if (source.length >= 20 && text.length < source.length * 0.25) w.push('much_shorter');
  if (text !== text.trim() || /^\s/.test(source) !== /^\s/.test(text) || /\s$/.test(source) !== /\s$/.test(text)) w.push('whitespace_differs');
  if (END_PUNCT.test(source.trim()) !== END_PUNCT.test(text.trim())) w.push('punctuation_differs');
  if (text === source && source.length > 3) w.push('same_as_source');
  const known = new Set(source.match(URL_OR_EMAIL) ?? []);
  if ((text.match(URL_OR_EMAIL) ?? []).some((u) => !known.has(u))) w.push('new_url_or_email');
  if (/<\/?[A-Za-z][^>]*>/.test(text) && !/<\/?[A-Za-z][^>]*>/.test(source)) w.push('looks_like_markup');
  return w;
}
