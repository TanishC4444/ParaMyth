import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { backendFetch, currentAccountIdentity, currentStudioIdentity, setStudioIdentity, setAccountIdentity, studioHost } from './api'
import { PageLoading, RecoveryPage } from './system-pages'
import { LEGAL_ROUTES } from './legal-routes'
import { resolveRoute } from './routes'
import AccountPage from './AccountPage'
import JoinTeam from './JoinTeam'

type Account = { id: string; email: string; display_name: string }
export type Team = { id: string; name: string; role: 'owner'|'admin'|'editor'|'viewer' }
type Access = { accounts_required: boolean; shared_keys: boolean; github_admin: boolean; authenticated?: boolean; teams?:Team[]; studio?:Team; openStudio?:(id:string)=>Promise<void> }
const localAccess: Access = {accounts_required:false, shared_keys:false, github_admin:true}
const AccessContext = createContext<Access>(localAccess)
export const useAccess = () => useContext(AccessContext)
const remember = (account:string, id:string) => { try { sessionStorage.setItem('paramyth-studio:'+account,id) } catch {} }
const remembered = (account:string) => { try { return sessionStorage.getItem('paramyth-studio:'+account)||'' } catch { return '' } }
const params = () => new URLSearchParams(location.hash.split('?')[1] || '')

export default function AccountGate({children}: {children:ReactNode}) {
  const [access,setAccess] = useState<Access>()
  const [account,setAccount] = useState<Account|null>()
  const [error,setError] = useState('')
  const [hash,setHash] = useState(location.hash)
  const checkAccount = useRef<() => Promise<void>>(async () => {})
  const route = hash.replace(/^#\/?/,'').split(/[/?]/)[0]
  const invitation = new URLSearchParams(hash.split('?')[1]||'').get('invite') || ''
  useEffect(() => {
    const changed=()=>{
      setHash(location.hash)
      const id=params().get('studio')
      if(id!==null && (id==='personal'?'':id)!==currentStudioIdentity()) void checkAccount.current()
    }
    window.addEventListener('hashchange',changed)
    return()=>window.removeEventListener('hashchange',changed)
  },[])
  useEffect(() => {
    if (!studioHost()) { setAccount(null);setAccess(localAccess);return }
    let stopped=false, generation=0
    const check=async () => {
      const request=++generation
      try {
        const config=await backendFetch('/api/ui/public-config',{cache:'no-store'})
        const value:Access=config.status===404 ? localAccess : await config.json()
        if (!config.ok && config.status!==404) throw Error('Could not check your sign-in. Please retry.')
        let signedIn:Account|null=null, teams:Team[]=[]
        if(value.accounts_required){
          const result=await backendFetch('/api/v1/accounts/me',{cache:'no-store'})
          if(result.ok) signedIn=await result.json()
          else if(result.status!==401) throw Error('Account storage is unavailable. Please retry.')
          if(signedIn){
            const result=await backendFetch('/api/v1/studios',{cache:'no-store'})
            if(!result.ok)throw Error('Could not load your teams.')
            teams=await result.json()
          }
        }
        if(stopped || request!==generation)return
        setAccountIdentity(signedIn?.id || 'local')
        const requested=params().get('studio')
        const selected=requested==='personal'?'':requested || (signedIn?remembered(signedIn.id):'')
        const studio=teams.find(team=>team.id===selected)
        setStudioIdentity(studio?.id || '')
        if(signedIn)remember(signedIn.id,studio?.id || '')
        const openStudio=async(id:string)=>{
          if(!signedIn || currentAccountIdentity()!==signedIn.id)throw Error('Sign in before opening a team workspace.')
          const response=await backendFetch('/api/v1/studios',{cache:'no-store'})
          if(!response.ok)throw Error('Could not check team access.')
          const available:Team[]=await response.json()
          const chosen=available.find(team=>team.id===id)
          if(id && !chosen)throw Error('You no longer have access to this team.')
          if(stopped || currentAccountIdentity()!==signedIn.id)return
          remember(signedIn.id,id);setStudioIdentity(id)
          setAccess({...value,authenticated:true,teams:available,studio:chosen,openStudio})
          location.hash='#/projects?studio='+encodeURIComponent(id || 'personal')
        }
        setAccount(signedIn);setAccess({...value,authenticated:!!signedIn,teams,studio,openStudio});setError('')
      }catch(e){if(!stopped && request===generation)setError(e instanceof Error?e.message:'Could not check your sign-in')}
    }
    checkAccount.current=check
    const changed=()=>{void check()}
    const storage=(e:StorageEvent)=>{if(e.key==='paramyth-account-change'){setAccount(undefined);changed()}}
    void check()
    window.addEventListener('focus',changed);window.addEventListener('storage',storage);window.addEventListener('paramyth-sign-in-required',changed)
    return()=>{stopped=true;window.removeEventListener('focus',changed);window.removeEventListener('storage',storage);window.removeEventListener('paramyth-sign-in-required',changed)}
  },[])
  const joining=route==='join'
  const authRoute=route==='signin' || route==='signup'
  const publicRoute=route==='' || route==='atlas' || (LEGAL_ROUTES as readonly string[]).includes(route) || (!joining && !authRoute && resolveRoute('#/'+route)==='notfound')
  const provided=access || {accounts_required:true,shared_keys:true,github_admin:false,authenticated:false}
  if(publicRoute)return <AccessContext.Provider value={provided}><div key={(account?.id||'local')+':'+(access?.studio?.id||'personal')+':'+(access?.studio?.role||'owner')}>{children}</div></AccessContext.Provider>
  if(error)return <RecoveryPage message="We couldn’t connect to your Studio. Please check your connection and try again." />
  if(!access || account===undefined)return <div className="night-page"><PageLoading label="Opening your workspace…" /></div>
  if(authRoute || (!publicRoute && (!studioHost() || access.accounts_required&&!account))) return <AccountPage key={route==='signup'?'signup':'signin'} invitation={invitation} signup={route==='signup'} available={studioHost()} onSignedIn={()=>checkAccount.current()} />
  if(joining)return <AccessContext.Provider value={access}><JoinTeam token={invitation} accountId={account?.id || ''} /></AccessContext.Provider>
  return <AccessContext.Provider value={access}><div key={(account?.id||'local')+':'+(access.studio?.id||'personal')+':'+(access.studio?.role||'owner')}>{account&&<div className="account-status" style={{padding:'8px 24px',display:'flex',gap:16,justifyContent:'flex-end'}}><span>Signed in as {account.display_name}</span><a href="/studio/account.html">Account & sign out</a></div>}{children}</div></AccessContext.Provider>
}
