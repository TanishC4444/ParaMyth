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
test('the book becomes a horizon before the Atlas controls appear', () => {
  const { chapterMotion } = motion();
  assert.equal(chapterMotion(0).hero, 1);
  assert.equal(chapterMotion(0).book, 1);
  assert.equal(chapterMotion(.76).collapse, 1);
  assert.ok(chapterMotion(.77).horizon > .99);
  assert.equal(chapterMotion(.8).controls, 0);
  assert.equal(chapterMotion(.95).earth, 1);
  assert.equal(chapterMotion(.95).book, 0);
  assert.equal(chapterMotion(1).atlas, 1);
  assert.equal(chapterMotion(1).controls, 1);
  assert.equal(chapterMotion(1).horizon, 0);
});
test('autoplay is frame-rate independent, bounded, and a direct Atlas entry finishes promptly', () => {
  const { advanceScene } = motion();
  const simulate = (hz, ms, skip = false) => {
    let p = 0; for (let i = 0; i < hz * ms / 1000; i++) p = advanceScene(p, 1000 / hz, skip); return p;
  };
  assert.ok(Math.abs(simulate(30, 4400) - simulate(120, 4400)) < .00001);
  assert.ok(simulate(60, 18000) > .9999);
  assert.ok(simulate(60, 1600, true) > .9999);
  assert.equal(advanceScene(.4, -100), .4);
  assert.equal(advanceScene(.99, 1000), 1);
});
test('the horizon bridges the book and globe without an empty visual frame', () => {
  const { chapterMotion } = motion();
  for (let i = 0; i <= 1000; i++) {
    const state = chapterMotion(i / 1000);
    assert.ok(Math.max(state.book, state.earth, state.horizon) > .35);
  }
});

test('playback reverses at the same speed without resetting its current position', () => {
  const { advanceScene, chapterMotion } = motion();
  const original = .43;
  const forward = advanceScene(original, 1500);
  const backward = advanceScene(forward, 1500, false, -1);
  assert.ok(Math.abs(original - backward) < 1e-12);
  assert.deepEqual(chapterMotion(original), chapterMotion(backward));
  assert.equal(advanceScene(.01, 1000, false, -1), 0);
  assert.equal(advanceScene(.99, 1000), 1);
});
test('the book begins open and cycles its illustrations before collapsing', () => {
  const { chapterMotion } = motion();
  const cover = chapterMotion(0);
  assert.equal(cover.open, 1);
  assert.equal(cover.leaf0, 0);
  assert.equal(chapterMotion(.22).leaf0, 1);
  assert.equal(chapterMotion(.39).leaf1, 1);
  assert.equal(chapterMotion(.55).leaf2, 1);
  assert.equal(chapterMotion(.55).collapse, 0);
});
