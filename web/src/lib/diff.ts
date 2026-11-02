// Word-level diff (longest common subsequence) for the review queue. Texts are short, so O(n*m) is fine.
export interface Part { kind: 'same' | 'added' | 'removed'; text: string }

export function wordDiff(before: string, after: string): Part[] {
  const a = before.split(/(\s+)/), b = after.split(/(\s+)/);
  if (a.length * b.length > 250_000) return [{ kind: 'removed', text: before }, { kind: 'added', text: after }];
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: Part[] = [];
  const push = (kind: Part['kind'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text; else out.push({ kind, text });
  };
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push('same', a[i]!); i++; j++; } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) push('removed', a[i++]!); else push('added', b[j++]!);
  }
  while (i < a.length) push('removed', a[i++]!);
  while (j < b.length) push('added', b[j++]!);
  return out.filter((p) => p.text);
}
