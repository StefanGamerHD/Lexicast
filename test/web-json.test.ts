import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJson } from '../web/src/lib/json.ts';

// The import screen reports line and column of a JSON error even where the engine's message names no position.
test('JSON errors are located by line and column', () => {
  const at = (s: string) => { const r = parseJson(s); return r.ok ? 'ok' : `${r.line}:${r.column}`; };
  assert.equal(at('{\n  "a": "x",\n  "b": \n}'), '4:1');   // value missing before }
  assert.equal(at('{\n "a": "x"\n "b": 1}'), '3:2');       // missing comma
  assert.equal(at('{"a": "x",}'), '1:11');                  // trailing comma
  assert.equal(at('{"a": '), '1:7');                         // input ends early
  assert.equal(at('{"a": "line\nbreak"}'), '1:12');          // raw newline inside a string
  assert.equal(at('nope'), '1:1');
  assert.equal(at('{"a": {"b": ["x", 1.5e3, true, null, "\\u00e4"]}}'), 'ok');
});
