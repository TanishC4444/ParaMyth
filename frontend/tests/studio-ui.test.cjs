const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = resolve(__dirname, '..');
const blank = { id:'', title:'Your new story', scenes:[], canon:[], versions:[], brief:{ medium:'Novel', genre:'Literary', premise:'', characters:[] }, updated:'2026-10-25T08:00:00Z' };
function render(path, { access = {}, studio = {}, props = {} } = {}) {
  const cache = new Map();
  const state = { project:blank, store:{ projects:[] }, jobs:[], go(){}, selectProject(){}, ...studio };
  function load(file) {
    if (/[\\/]store$/.test(file)) return { useStudio:()=>state, blankProject:()=>blank, useDraftState:(key,initial)=>React.useState(studio.drafts?.[key] ?? initial) };
    if (/[\\/]AccountGate$/.test(file)) return {useAccess:()=>access};
    if (/[\\/]api$/.test(file)) return {};
    if (/[\\/]site$/.test(file)) return {REPOSITORY:'https://github.com/TanishC4444/ParaMyth'};
    if (file.endsWith('.css')) return {};
    const full = [file,file+'.ts',file+'.tsx',file+'.json'].find(existsSync);
    if (!full) throw Error('Missing '+file);
    if (full.endsWith('.json')) return JSON.parse(readFileSync(full,'utf8'));
    if (cache.has(full)) return cache.get(full).exports;
    const module = {exports:{}}; cache.set(full,module);
    const source = readFileSync(full,'utf8').replaceAll('import.meta.env','({BASE_URL:"/",VITE_API_BASE:""})');
    const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2020}}).outputText;
    vm.runInNewContext(code,{exports:module.exports,module,require:id=>id.startsWith('.')?load(resolve(dirname(full),id)):require(id),location:{hash:'#/overview'},URLSearchParams,console});
    return module.exports;
  }
  return renderToStaticMarkup(React.createElement(load(resolve(root,path)).default,props));
}
test('a viewer sees workspace information without project creation actions',()=>{
  const html = render('src/views/Overview.tsx',{access:{studio:{role:'viewer',name:'Writers'}}});
  assert.match(html,/Ask a team owner or editor/);
  assert.doesNotMatch(html,/<button[^>]*>[^<]*Create/);
  assert.doesNotMatch(html,/New project/);
});
test('empty projects explain how to start instead of asking to clear nonexistent filters',()=>{
  const html = render('src/views/Projects.tsx');
  assert.match(html,/Your first project starts here/);
  assert.match(html,/Create a project/);
  assert.doesNotMatch(html,/No matching projects/);
  assert.match(html,/aria-label="Search projects"/);
  assert.match(html,/aria-pressed="true"/);
});
test('activity shows real job states and readable job names for account workspaces',()=>{
  const html = render('src/views/Runs.tsx',{access:{github_admin:false},studio:{jobs:[{id:'job-1',kind:'image_prompt',status:'queued',message:'Waiting for a worker',created_at:'2026-10-25T08:00:00Z'}]}});
  assert.match(html,/image prompt/);
  assert.match(html,/Waiting for a worker/);
  assert.match(html,/status queued/);
  assert.match(html,/dateTime="2026-10-25T08:00:00Z"/);
});
test('an account workspace with no jobs gets an honest activity empty state',()=>{
  const html = render('src/views/Runs.tsx',{access:{github_admin:false}});
  assert.match(html,/A clear view of work in progress/);
  assert.doesNotMatch(html,/Start a writing workflow/);
});

test('activity hides provider configuration diagnostics in saved job messages',()=>{
  const html=render('src/views/Runs.tsx',{studio:{jobs:[{id:'failed-image',kind:'image_generate',status:'failed',message:'Set MUSE_IMAGE_API_KEY in the server environment',created_at:'2026-10-25T08:00:00Z'}]}});
  assert.match(html,/Image generation isn&#x27;t available in this studio yet/);
  assert.doesNotMatch(html,/_API_KEY|server environment/);
});

test('older projects without a scene-length preference still open the manuscript',()=>{
  const project={...blank,scenes:[{id:'scene',chapter:1,title:'Chapter one',pov:'',location:'',content:'',state:'Draft',findings:[]}],brief:{...blank.brief,wordMin:100,wordMax:200}};
  const html=render('src/views/ProjectWorkspace.tsx',{studio:{project,drafts:{'project.tab':'manuscript'}},props:{embedded:true}});
  assert.match(html,/\(guided\)/);
  assert.match(html,/Point of view/);
  assert.match(html,/Location/);
});
