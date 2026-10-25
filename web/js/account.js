const $=id=>document.getElementById(id);
const base=document.querySelector('meta[name="paramyth-api"]')?.content || location.origin;
async function api(path,body){
  let response;
  try{response=await fetch(base+'/api/v1'+path,{credentials:'include',cache:'no-store',method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)})}
  catch{throw new Error("We couldn't reach your studio. Try again in a moment.")}
  let value=null;
  if(response.status!==204 && (response.headers.get('content-type')||'').includes('json'))try{value=await response.json()}catch{}
  if(!response.ok || response.status!==204&&!value){
    const message=response.status===503?"Accounts aren't available in this studio yet.":response.status===401?'Sign in to open your account.':response.status===404||!value?"We couldn't reach your studio. Try again in a moment.":typeof value?.detail==='string'?value.detail:'Could not complete this request. Try again.';
    throw Object.assign(new Error(message),{status:response.status});
  }
  return value;
}
function signedOut(){try{localStorage.setItem('paramyth-account-change',String(Date.now()))}catch{}location.replace('/#/signin')}
async function loadAccount(){
  $('profile').textContent='Opening your account…';$('message').textContent='';$('logout').hidden=true;$('password-panel').hidden=true;$('account-retry').hidden=true;
  try{const user=await api('/accounts/me');$('profile').textContent=user.display_name+' · '+user.email;$('logout').hidden=false;$('password-panel').hidden=false}
  catch(error){$('profile').textContent=error.status===401?'Sign in to open your account.':'Your account is unavailable.';if(error.status===401)signedOut();else{$('message').textContent=error.message;$('account-retry').hidden=false}}
}
void loadAccount();
$('account-retry').addEventListener('click',()=>void loadAccount());
$('logout').addEventListener('click',async()=>{try{$('logout').disabled=true;await api('/accounts/logout',{});signedOut()}catch(error){$('message').textContent=error.message;$('logout').disabled=false}});
$('password-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;try{await api('/accounts/password',{current_password:$('current-password').value,new_password:$('new-password').value});signedOut()}catch(error){$('message').textContent=error.message;button.disabled=false}});
