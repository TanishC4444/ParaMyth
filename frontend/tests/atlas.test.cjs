const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const path = resolve(__dirname, '../src/atlas.ts');
const corpus = JSON.parse(readFileSync(resolve(__dirname, '../public/atlas/stories.json'), 'utf8'));
function atlas(fetch, hostname = 'localhost') {
  // Supply Vite's base URL while executing the actual atlas module in isolation.
  const source = readFileSync(path, 'utf8').replaceAll('import.meta.env.BASE_URL', '"/"');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: createRequire(path), fetch, AbortSignal, localStorage: { getItem: () => null }, location: { hostname } });
  return exports;
}
const response = (body) => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => body });
test('385 real story pins are available before any network response', async () => {
  let finish;
  const module = atlas(() => new Promise((r) => { finish = r; }));
  const pending = module.loadAtlas();
  assert.equal(module.bundledAtlas.index.stories.length, 385);
  assert.deepEqual(module.bundledAtlas.index.stories.map((s) => s.id), corpus.stories.map((s) => s.id));
  finish(response({ ...module.bundledAtlas.index, corpus: 'Live refreshed corpus' }));
  assert.equal((await pending).origin.kind, 'api');
});
test('offline, failed and malformed API responses keep the bundled corpus', async () => {
  for (const fetch of [async () => { throw Error('offline'); }, async () => ({ ok: false, status: 503 }), async () => response({ stories: [] })]) {
    const module = atlas(fetch);
    assert.equal(await module.loadAtlas(), module.bundledAtlas);
  }
});
test('story details work offline and a failed asset request can be retried', async () => {
  let count = 0;
  const module = atlas(async (url) => {
    assert.equal(url, '/atlas/stories.json');
    if (++count === 1) throw Error('Temporary asset failure');
    return response(corpus);
  });
  await assert.rejects(module.loadStory('work_001', { kind: 'snapshot' }));
  const story = await module.loadStory('work_001', { kind: 'snapshot' });
  assert.equal(story.id, 'work_001');
  assert.ok(story.summary.includes('gingerbread'));
});

test('the public website does not ask its own origin for the studio API', async () => {
  const requests = [];
  const module = atlas(async (url) => { requests.push(url); throw Error('offline'); }, 'paramyth.tech');
  assert.equal(await module.loadAtlas(), module.bundledAtlas);
  assert.deepEqual(requests, []);
});
