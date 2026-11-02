// Parses JSON and reports where it breaks as line and column. The browser's messages do not always name a
// position, so a small syntax scanner finds the first offending character itself.
export type Parsed = { ok: true; value: unknown } | { ok: false; line: number; column: number; detail: string };

export function parseJson(text: string): Parsed {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    const at = errorOffset(text);
    const before = text.slice(0, at).split('\n');
    return { ok: false, line: before.length, column: before[before.length - 1]!.length + 1, detail: (e as Error).message };
  }
}

// Offset of the first syntax error (text.length when the input simply ends too early).
export function errorOffset(s: string): number {
  let i = 0;
  const ws = () => { while (i < s.length && ' \t\n\r'.includes(s[i]!)) i++; };
  const fail = (): never => { throw i; };
  const lit = (word: string) => { if (s.startsWith(word, i)) i += word.length; else fail(); };
  function str() {
    i++; // opening quote
    while (i < s.length && s[i] !== '"') {
      if (s.charCodeAt(i) < 0x20) fail();
      if (s[i] === '\\') {
        i++;
        if (s[i] === 'u') { if (!/^[0-9a-fA-F]{4}$/.test(s.slice(i + 1, i + 5))) fail(); i += 5; continue; }
        if (!'"\\/bfnrt'.includes(s[i] ?? '')) fail();
      }
      i++;
    }
    if (i >= s.length) fail();
    i++;
  }
  function num() {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(s.slice(i));
    if (!m) fail();
    i += m![0].length;
  }
  function value() {
    ws();
    const c = s[i];
    if (c === '{') {
      i++; ws();
      if (s[i] === '}') { i++; return; }
      for (;;) {
        ws(); if (s[i] !== '"') fail(); str(); ws();
        if (s[i] !== ':') fail(); i++; value(); ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === '}') { i++; return; }
        fail();
      }
    }
    if (c === '[') {
      i++; ws();
      if (s[i] === ']') { i++; return; }
      for (;;) {
        value(); ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === ']') { i++; return; }
        fail();
      }
    }
    if (c === '"') return str();
    if (c === 't') return lit('true');
    if (c === 'f') return lit('false');
    if (c === 'n') return lit('null');
    return num();
  }
  try {
    value(); ws();
    return i < s.length ? i : s.length;
  } catch (at) {
    return Math.min(at as number, s.length);
  }
}
