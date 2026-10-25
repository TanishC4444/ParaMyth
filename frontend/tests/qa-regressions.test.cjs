const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const root = resolve(__dirname, '..');
function moduleFor(file, mocks = {}, globals = {}, extra = '') {
  const module = {exports:{}};
  const source = readFileSync(resolve(root,file),'utf8');
  const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code+extra,{module,exports:module.exports,require:name=>name in mocks?mocks[name]:require(name),URL,URLSearchParams,AbortSignal,console,location:{origin:'http://localhost:4173'},...globals});
  return module.exports;
}

test('service diagnostics become useful messages without exposing key names',()=>{
  const {requestMessage}=moduleFor('src/request-errors.ts');
  assert.match(requestMessage('Set MUSE_IMAGE_API_KEY or MODEL_API_KEY in the environment'),/Image generation isn't available/);
  assert.match(requestMessage('Set VULTR_MUSIC_API_KEY in the server environment'),/Music generation isn't available/);
  for(const text of ['Unexpected token <','Live studio request failed (404). Check Connections.','VULTR_INFERENCE_API_KEY']) assert.doesNotMatch(requestMessage(text),/Unexpected token|failed \(404\)|_API_KEY/);
  assert.equal(requestMessage('Choose a chapter before revising.'),'Choose a chapter before revising.');
});

test('missing optional endpoints are requested once, across project query changes',async()=>{
  let calls=0;
  const errors=moduleFor('src/request-errors.ts');
  const api=moduleFor('src/api.ts',{'./request-errors':errors,'./transport':{studioHost:()=>true,currentStudioIdentity:()=>'',backendUrl:p=>p,backendFetch:async()=>{calls++;return {ok:false,status:404,headers:{get:()=> 'application/json'},json:async()=>({detail:'Not Found'})}}}});
  assert.equal(await api.optionalApi('/api/ui/jobs?project_id=one'),null);
  assert.equal(await api.optionalApi('/api/ui/jobs?project_id=two'),null);
  assert.equal(calls,1);
});

test('the gallery remains the asset source when the optional materials endpoint is missing',async()=>{
  const mocks={'./api':{currentWorkspaceIdentity:()=> 'account:',projectPath:(p,id)=>p+'&project_id='+id,optionalApi:async()=>null,api:async p=>p.startsWith('/api/images')?{images:[{id:'kept',project_id:'project'}]}:{tracks:[]}},'./store':{}};
  const materials=moduleFor('src/materials.tsx',mocks,{},'\nexports.inspect={load,cache};');
  await materials.inspect.load('project','latest');
  assert.equal(materials.inspect.cache('account::project:latest').value.images[0].id,'kept');
  assert.equal(materials.projectAssets([{id:'mine',project_id:'project'},{id:'other',job:{project_id:'foreign'}}],'project').length,1);
});

function accountHarness(status, contentType='application/json', network=false) {
  const nodes=new Map();let redirect='',parsed=0;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:'',events:{},addEventListener(name,fn){this.events[name]=fn}});return nodes.get(id)};
  const context={document:{getElementById:node,querySelector:()=>null},location:{origin:'https://pages.test',replace:value=>{redirect=value}},localStorage:{setItem(){}},AbortSignal,fetch:async()=>{
    if(network)throw new TypeError('Failed to fetch');
    return {ok:status===200,status,headers:{get:()=>contentType},json:async()=>{parsed++;return {detail:'Studio accounts are not configured on this server'}}};
  }};
  vm.runInNewContext(readFileSync(resolve(root,'../web/js/account.js'),'utf8'),context);
  return {node,redirect:()=>redirect,parsed:()=>parsed,settle:()=>new Promise(resolve=>setImmediate(resolve))};
}
for(const scenario of [{status:404,type:'text/html'},{status:503,type:'application/json'},{status:0,network:true}])test('account failure resolves loading and hides private controls: '+scenario.status,async()=>{
  const h=accountHarness(scenario.status,scenario.type,scenario.network);await h.settle();
  assert.equal(h.node('profile').textContent,'Your account is unavailable.');
  assert.equal(h.node('logout').hidden,true);assert.equal(h.node('password-panel').hidden,true);
  assert.doesNotMatch(h.node('message').textContent,/Unexpected token|<|not configured on this server/);
  if(scenario.type==='text/html')assert.equal(h.parsed(),0);
});
test('account authentication failure redirects to the single sign-in route',async()=>{
  const h=accountHarness(401);await h.settle();assert.equal(h.redirect(),'/#/signin');
});

test('a failed Instagram embed renders a compact retry card without the empty frame',()=>{
  let state=0;
  const component=moduleFor('src/Instagram.tsx',{'react':{...React,useState:initial=>React.useState(state++===0?true:initial)},'./contact':{INSTAGRAM_PROFILE:'https://www.instagram.com/paramythofficial/'}}).default;
  const html=renderToStaticMarkup(React.createElement(component,{enabled:false}));
  assert.match(html,/embed-failed/);assert.match(html,/Open Instagram/);assert.match(html,/Try Again/);
  assert.doesNotMatch(html,/class="instagram-frame"|<blockquote/);
});
