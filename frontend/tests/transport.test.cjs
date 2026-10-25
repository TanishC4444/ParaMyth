const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function transport(base = '', hostname = 'paramyth.tech') {
  const requests = [];
  const source = readFileSync(resolve(__dirname, '../src/transport.ts'), 'utf8').replaceAll('import.meta.env.VITE_API_BASE', JSON.stringify(base));
  const code = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const exports = {};
  vm.runInNewContext(code, {exports, URL, location:{hostname,origin:`https://${hostname}`}, document:{querySelector:()=>null}, fetch:async (...args)=>{requests.push(args);return {ok:true}}});
  return {client:exports, requests};
}

test('GitHub frontend sends API and media paths to the configured Railway backend', async () => {
  const {client,requests} = transport('https://studio.up.railway.app');
  assert.equal(client.studioHost(),true);
  assert.equal(client.backendUrl('/media/images/image/0.png?project_id=p'), 'https://studio.up.railway.app/media/images/image/0.png?project_id=p');
  await client.backendFetch('/api/ui/session');
  assert.equal(requests[0][0], 'https://studio.up.railway.app/api/ui/session');
  assert.equal(requests[0][1].credentials, 'include');
  assert.equal(client.backendUrl(requests[0][0]), requests[0][0]);
  assert.throws(()=>client.backendUrl('https://unrelated.example/api'),/Unexpected backend/);
  assert.throws(()=>client.backendUrl('//unrelated.example/api'),/Expected a backend/);
});

test('unconfigured exports stay offline and local development keeps relative URLs', () => {
  assert.equal(transport().client.studioHost(),false);
  const {client} = transport('', 'localhost');
  assert.equal(client.studioHost(),true);
  assert.equal(client.backendUrl('/api/ui/session'),'/api/ui/session');
  assert.throws(()=>transport('http://untrusted.example'),/HTTPS backend/);
});
