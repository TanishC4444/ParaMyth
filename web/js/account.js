const $=id=>document.getElementById(id);
const base=document.querySelector('meta[name="paramyth-api"]')?.content || location.origin;
async function api(path,body){
  const response=await fetch(base+'/api/v1'+path,{credentials:'include',cache:'no-store',method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const value=response.status===204?null:await response.json();
  if(!response.ok)throw Object.assign(new Error(typeof value?.detail==='string'?value.detail:'Could not complete this request'),{status:response.status});
  return value;
}
function signedOut(){try{localStorage.setItem('paramyth-account-change',String(Date.now()))}catch{}location.replace('/#/signin')}
api('/accounts/me').then(user=>{$('profile').textContent=user.display_name+' · '+user.email}).catch(error=>{if(error.status===401)signedOut();else $('message').textContent=error.message});
$('logout').addEventListener('click',async()=>{try{$('logout').disabled=true;await api('/accounts/logout',{});signedOut()}catch(error){$('message').textContent=error.message;$('logout').disabled=false}});
$('password-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;try{await api('/accounts/password',{current_password:$('current-password').value,new_password:$('new-password').value});signedOut()}catch(error){$('message').textContent=error.message;button.disabled=false}});
