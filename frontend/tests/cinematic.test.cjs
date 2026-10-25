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

test('chapter curves remain finite and bounded throughout fast forward and reverse scrolling', () => {
  const { chapterMotion } = motion();
  for (let i = -100; i <= 1100; i++) {
    const p = i / 1000;
    const state = chapterMotion(p);
    for (const [key, value] of Object.entries(state)) {
      assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, `${key} at ${p}`);
    }
    assert.deepEqual(chapterMotion(p), state, 'scroll history cannot affect a frame');
  }
});
test('the book assembles before Earth takes over, and Atlas is fully visible at the destination', () => {
  const { chapterMotion } = motion();
  assert.equal(chapterMotion(0).hero, 1);
  assert.equal(chapterMotion(0).book, 1);
  assert.ok(chapterMotion(.27).burst > .99);
  assert.equal(chapterMotion(.58).burst, 0);
  assert.equal(chapterMotion(.58).unfold, 1);
  assert.equal(chapterMotion(.58).book, 1);
  assert.equal(chapterMotion(.78).earth, 1);
  assert.equal(chapterMotion(.78).book, 0);
  assert.equal(chapterMotion(1).atlas, 1);
  assert.equal(chapterMotion(1).earth, 0);
  assert.equal(chapterMotion(0).atlas, 0);
});
test('the reveal has no blank chapter between book and Earth', () => {
  const { chapterMotion } = motion();
  for (let i = 0; i <= 1000; i++) {
    const state = chapterMotion(i / 1000);
    assert.ok(Math.max(state.book, state.earth, state.atlas) > .35);
  }
});
