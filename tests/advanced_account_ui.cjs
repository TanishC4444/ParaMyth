const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const test=require('node:test');
function harness(status=409,contentType='application/json'){
 const nodes=new Map(),calls=[];
 const node=id=>{
  if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,disabled:false,textContent:'',events:{},attrs:{},
   setAttribute(k,v){this.attrs[k]=v},addEventListener(k,v){this.events[k]=v},closest(){return node(id+'-parent')},querySelector(){return node(id+'-option')},replaceChildren(){}});
  return nodes.get(id);
 };
 const location=new URL('http://127.0.0.1:5176/studio/teams.html?mode=signup');
 const context={URL,URLSearchParams,AbortSignal,location,history:{replaceState(a,b,url){location.href=String(url)}},localStorage:{getItem(){return null}},
  document:{getElementById:node,querySelector(){return null},querySelectorAll(){return [...nodes.values()]}},window:{addEventListener(){}},
  fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:false,status,headers:{get:()=>contentType},json:async()=>({detail:status===409?'Unable to create this account. Try signing in.':'Email or password is incorrect'})}}};
 vm.runInNewContext(readFileSync('web/js/teams.js','utf8'),context);
 node('email').value='test@example.invalid';node('password').value='example password';node('display-name').value='Test';
 return {node,calls,location,submit:()=>node('account-form').events.submit({preventDefault(){},submitter:node('account-submit')})};
}
test('duplicate signup switches to sign-in, preserves email and waits for a deliberate login',async()=>{
 const h=harness();await h.submit();
 assert.equal(h.calls.length,1);assert.ok(h.calls[0].url.endsWith('/accounts/signup'));
 assert.equal(h.node('account-submit').value,'login');assert.equal(h.node('email').value,'test@example.invalid');
 assert.equal(h.node('display-name-field').hidden,true);assert.equal(h.node('display-name').required,false);
 assert.match(h.node('account-message').textContent,/existing password/);assert.equal(h.location.search,'');
 assert.equal(h.node('account-submit').disabled,false);
});
test('login error stays inline and never submits display-name',async()=>{
 const h=harness(401);h.node('show-login').events.click();await h.submit();
 assert.ok(h.calls[0].url.endsWith('/accounts/login'));assert.equal('display_name' in h.calls[0].body,false);
 assert.match(h.node('account-message').textContent,/Email or password/);
 assert.equal(h.node('account-submit').value,'login');
});
test('HTML from static hosting is shown as an actionable account message',async()=>{
 const h=harness(404,'text/html');await h.submit();
 assert.match(h.node('account-message').textContent,/couldn't reach your studio/);
 assert.doesNotMatch(h.node('account-message').textContent,/Unexpected token|JSON/);
});
