const assert = require('node:assert/strict');
const {readFileSync, existsSync} = require('node:fs');
const {resolve, dirname} = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const root = resolve(__dirname, '..');
function loader(hash = '#/') {
  const cache = new Map();
  const load = file => {
    if (!file.startsWith('.' ) && !file.startsWith('/')) return require(file);
    const path = file.startsWith('/') ? file : resolve(root, file);
    if (path.endsWith('.css')) return {};
    const full = [path,path+'.ts',path+'.tsx',path+'.json'].find(existsSync);
    if (!full) throw Error('Missing '+path);
    if (full.endsWith('.json')) return JSON.parse(readFileSync(full,'utf8'));
    if (cache.has(full)) return cache.get(full).exports;
    const module = {exports:{}};cache.set(full,module);
    let source = readFileSync(full,'utf8').replaceAll('import.meta.env.BASE_URL', '"/"');
    // The server-render checks never call API methods; this only supplies the hosting flag.
    const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
    vm.runInNewContext(code,{module,exports:module.exports,require:id=>id.startsWith('.')?load(resolve(dirname(full),id)):require(id),location:{hash,hostname:'paramyth.tech'},document:{querySelector:()=>null},console,URL,AbortSignal});
    return module.exports;
  };
  return path => load(resolve(root,path));
}
test('legal links resolve, unknown routes show 404, and story anchors keep working',()=>{
 const {resolveRoute} = loader()('src/routes.ts');
 for(const page of ['terms','privacy','contact','accessibility','credits']) assert.equal(resolveRoute('#/'+page),'legal');
 assert.equal(resolveRoute('#/missing-page'),'notfound');
 assert.equal(resolveRoute('#/atlas'),'atlas');
 assert.equal(resolveRoute('#/images'),'workflow');
 assert.equal(resolveRoute('#landing-main'),'landing');
 assert.equal(resolveRoute(''),'landing');
});
test('every displayed illustration has a source, rights record, and optimized local image',()=>{
 const {BOOK_ART,GALLERY_ART} = loader()('src/cinematic/scenes.ts');
 const credits = JSON.parse(readFileSync(resolve(root,'src/art-credits.json')));
 assert.equal(BOOK_ART.length,12);assert.equal(new Set(GALLERY_ART).size,GALLERY_ART.length);
 for(const name of GALLERY_ART){
  const credit=credits.find(c=>c.file===name+'.webp');assert.ok(credit?.source_page_url.startsWith('https://'),name);assert.ok(credit.license,name);
  assert.ok(existsSync(resolve(root,'public/art/book/'+name+'.webp')),name);
 }
 for(const generic of ['nebula','forest-path','edo-rain','edo-moon','ragamala-one','ragamala-two','music','castle','ruins']) assert.ok(!GALLERY_ART.includes(generic));
});
test('each legal destination renders a readable page and a working route home',()=>{
 const expected={terms:'Terms of Use',privacy:'Privacy &amp; Storage',contact:'Contact &amp; Support',accessibility:'Accessibility',credits:'Copyright &amp; Credits'};
 for(const [route,title] of Object.entries(expected)){
  const {default:Legal} = loader('#/'+route)('src/Legal.tsx');
  const html=renderToStaticMarkup(React.createElement(Legal));
  assert.ok(html.includes('<h1>'+title+'</h1>'),route);assert.ok(html.includes('href="#/"'),route);assert.ok(html.includes('id="legal-main"'),route);
 }
});

test('contact addresses and the supplied Instagram profile are visible without third-party scripts',()=>{
 const load=loader('#/contact');
 const Legal=load('src/Legal.tsx').default;
 const contact=renderToStaticMarkup(React.createElement(Legal));
 for(const email of ['paramythofficial@gmail.com','tanishchauhan4444@gmail.com','ronminin@gmail.com','aadityathegreat07@gmail.com']) assert.ok(contact.includes('mailto:'+email));
 const Instagram=load('src/Instagram.tsx').default;
 const embed=renderToStaticMarkup(React.createElement(Instagram,{enabled:false}));
 assert.ok(embed.includes('data-instgrm-permalink="https://www.instagram.com/paramythofficial/"'));
 assert.ok(embed.includes('Open Instagram'));
 assert.ok(!embed.includes('<script'));
});
test('legal and missing pages remain public while account storage is unavailable',()=>{
 for(const route of ['terms','privacy','contact','accessibility','credits','page-that-does-not-exist']){
  const Gate=loader('#/'+route)('src/AccountGate.tsx').default;
  const html=renderToStaticMarkup(React.createElement(Gate,null,React.createElement('main',{id:'public-page'})));
  assert.ok(html.includes('id="public-page"'),route);
 }
});
