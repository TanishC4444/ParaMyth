const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const source = readFileSync(resolve(__dirname, '../src/cinematic/motion.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function motion(sessionStorage) {
  const exports = {};
  vm.runInNewContext(code, { exports, sessionStorage });
  return exports;
}
test('scroll progress clamps, reverses, and adapts to the current viewport', () => {
  const { scrollProgress } = motion();
  assert.equal(scrollProgress(-10, 100, 3600, 1000), 0);
  assert.equal(scrollProgress(1400, 100, 3600, 1000), .5);
  assert.equal(scrollProgress(2700, 100, 3600, 1000), 1);
  assert.equal(scrollProgress(1400, 100, 3600, 1000), .5);
  assert.equal(scrollProgress(1400, 100, 3600, 500), 1300 / 3100);
  assert.equal(scrollProgress(9000, 100, 3600, 1000), 1);
  assert.equal(scrollProgress(100, 100, 0, 1000), 0);
});
test('navigation memory is scoped to the session and storage denial is safe', () => {
  const values = new Map();
  const m = motion({ getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) });
  assert.equal(m.hasSeenIntro(), false);
  m.rememberIntro();
  assert.equal(m.hasSeenIntro(), true);
  const blocked = motion({ getItem() { throw Error('Denied'); }, setItem() { throw Error('Denied'); } });
  assert.equal(blocked.hasSeenIntro(), false);
  assert.doesNotThrow(() => blocked.rememberIntro());
});
