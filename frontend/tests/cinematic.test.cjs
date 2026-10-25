const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const source = readFileSync(resolve(__dirname, '../src/cinematic/motion.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function motion(sessionStorage) { const exports = {}; vm.runInNewContext(code, { exports, sessionStorage }); return exports; }

test('native scroll progress clamps, reverses and adapts to responsive track heights', () => {
  const { scrollProgress } = motion();
  assert.equal(scrollProgress(-10, 100, 3600, 1000), 0);
  assert.equal(scrollProgress(1400, 100, 3600, 1000), .5);
  assert.equal(scrollProgress(2700, 100, 3600, 1000), 1);
  assert.equal(scrollProgress(1400, 100, 3600, 500), 1300 / 3100);
  assert.equal(scrollProgress(9000, 100, 3600, 1000), 1);
  assert.equal(scrollProgress(100, 100, 0, 1000), 0);
});
test('return visits preserve the selected view and last book position', () => {
  const values = new Map(); const m = motion({ getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) });
  assert.equal(m.readNavigation(), null);
  m.saveNavigation({ view: 'book', bookProgress: .36 });
  assert.equal(m.readNavigation().view, 'book'); assert.equal(m.readNavigation().bookProgress, .36);
  m.saveNavigation({ view: 'atlas', bookProgress: .51 });
  assert.equal(m.readNavigation().view, 'atlas'); assert.equal(m.readNavigation().bookProgress, .51);
  m.saveNavigation({ view: 'book', bookProgress: 9 }); assert.equal(m.readNavigation().bookProgress, .72);
  m.saveNavigation({ view: 'invalid', bookProgress: .2 }); assert.equal(m.readNavigation(), null);
});
test('invalid or denied session storage cannot break navigation', () => {
  const blocked = motion({ getItem() { throw Error('Denied'); }, setItem() { throw Error('Denied'); } });
  assert.equal(blocked.readNavigation(), null); assert.doesNotThrow(() => blocked.saveNavigation({view:'atlas',bookProgress:0}));
  assert.equal(motion({getItem: () => '{broken'}).readNavigation(), null);
});
test('every scene is a deterministic function of scroll, with no time input', () => {
  const { chapterMotion } = motion();
  for (let i = -100; i <= 1100; i++) {
    const p = i / 1000, state = chapterMotion(p);
    for (const [key, value] of Object.entries(state)) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, `${key} at ${p}`);
    assert.deepEqual(chapterMotion(p), state);
  }
});
test('five page turns unfold in order and retrace the same path backwards', () => {
  const { pageTurn, chapterMotion } = motion();
  for (let index = 0; index < 5; index++) {
    assert.equal(pageTurn(0, index), 0); assert.equal(pageTurn(.72, index), 1);
    let previous = 0;
    for (let step = 0; step <= 100; step++) { const value = pageTurn(step / 100, index); assert.ok(value >= previous); previous = value; }
  }
  const states = Array.from({length:101}, (_, i) => chapterMotion(i / 100));
  for (let i=100;i>=0;i--) assert.deepEqual(chapterMotion(i/100),states[i]);
});
test('the open book bridges to the globe without an empty visual frame', () => {
  const { chapterMotion } = motion();
  assert.equal(chapterMotion(0).open, 1); assert.equal(chapterMotion(0).book, 1);
  assert.equal(chapterMotion(.94).collapse, 1); assert.equal(chapterMotion(.93).horizon, 1);
  assert.equal(chapterMotion(.98).earth, 1); assert.equal(chapterMotion(1).controls, 1); assert.equal(chapterMotion(1).book, 0);
  for(let i=0;i<=1000;i++){const s=chapterMotion(i/1000);assert.ok(Math.max(s.book,s.earth,s.horizon)>.35);}
});
test('caption scenes stay bounded through fast scrolls and direct jumps', () => {
  const { sceneAt } = motion();
  assert.equal(sceneAt(-1),0); assert.equal(sceneAt(1),5);
  for(let i=0;i<6;i++) assert.equal(sceneAt(i*.12+.025),i);
});
test('only one caption can be visible at any scroll position', () => {
  const { chapterMotion } = motion();
  for (let i = 0; i <= 10000; i++) {
    const state = chapterMotion(i / 10000);
    assert.ok(Array.from({length: 6}, (_, n) => state[`scene${n}`]).filter(v => v > 0).length <= 1);
  }
});

test('page turns use nearly a full viewport of the longer scroll track', () => {
  const { pageTurn } = motion();
  assert.ok(pageTurn(.04,0) > 0 && pageTurn(.04,0) < .1);
  assert.ok(pageTurn(.08,0) > .4 && pageTurn(.08,0) < .6);
  assert.ok(pageTurn(.12,0) > .8 && pageTurn(.12,0) < 1);
  assert.equal(pageTurn(.14,0),1);
});
