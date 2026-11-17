const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');

function transport(base = '', hostname = 'paramyth.tech') {
  const requests = [];
  const values = new Map();
  const source = readFileSync(resolve(__dirname, '../src/transport.ts'), 'utf8').replaceAll('import.meta.env.VITE_API_BASE', JSON.stringify(base));
  const code = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const exports = {};
  vm.runInNewContext(code, {exports, URL, Headers, crypto:webcrypto, localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)}, location:{hostname,origin:`https://${hostname}`}, document:{querySelector:()=>null}, fetch:async (...args)=>{requests.push(args);return {ok:true}}});
  return {client:exports, requests};
}

test('GitHub frontend sends API and media paths to the configured Railway backend', async () => {
  const {client,requests} = transport('https://studio.up.railway.app');
  assert.equal(client.studioHost(),true);
  const media = new URL(client.backendUrl('/media/images/image/0.png?project_id=p'));
  assert.equal(media.origin, 'https://studio.up.railway.app');
  assert.equal(media.pathname, '/media/images/image/0.png');
  assert.equal(media.searchParams.get('project_id'), 'p');
  assert.match(media.searchParams.get('guest_id'), /^[0-9a-f-]{36}$/i);
  await client.backendFetch('/api/ui/session');
  assert.equal(requests[0][0], 'https://studio.up.railway.app/api/ui/session');
  assert.equal(requests[0][1].credentials, 'omit');
  assert.match(requests[0][1].headers.get('X-ParaMyth-Guest'), /^[0-9a-f-]{36}$/i);
  const firstGuest = requests[0][1].headers.get('X-ParaMyth-Guest');
  await client.backendFetch('/api/ui/session');
  assert.equal(requests[1][1].headers.get('X-ParaMyth-Guest'), firstGuest);
  assert.equal(requests[0][1].credentials, 'omit');
  assert.equal(new URL(client.backendUrl(requests[0][0])).origin, 'https://studio.up.railway.app');
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

test('team scope follows jobs, streams, media and exports without changing account endpoints', () => {
  const {client} = transport('https://studio.up.railway.app');
  client.setStudioIdentity('team-one');
  for (const path of ['/api/ui/workspace', '/api/ui/creative/jobs/run/events?project_id=p', '/media/images/i/0.png?project_id=p', '/export/p/docx', '/google/status']) {
    const url = new URL(client.backendUrl(path));
    assert.equal(url.searchParams.get('studio_id'), 'team-one', path);
    assert.equal(client.backendUrl(url.href), url.href);
  }
  for (const path of ['/api/v1/accounts/me', '/api/v1/studios', '/api/v1/invitations/accept'])
    assert.equal(new URL(client.backendUrl(path)).searchParams.has('studio_id'), false, path);
  const stale = client.backendUrl('/api/ui/workspace');
  client.setStudioIdentity('team-two');
  assert.throws(() => client.backendUrl(stale), /workspace changed/);
  client.setStudioIdentity('');
  assert.equal(client.backendUrl('/api/ui/workspace'), 'https://studio.up.railway.app/api/ui/workspace');
});
