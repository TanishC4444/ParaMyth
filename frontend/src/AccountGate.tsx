import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { setAccountIdentity, studioHost } from './api'
import AccountPage from './AccountPage'

type Account = { id: string; email: string; display_name: string }
type Access = { accounts_required: boolean; shared_keys: boolean; github_admin: boolean; authenticated?: boolean }
const localAccess: Access = {accounts_required:false, shared_keys:false, github_admin:true}
const AccessContext = createContext<Access>(localAccess)
export const useAccess = () => useContext(AccessContext)
const routeName = () => location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]

export default function AccountGate({children}: {children:ReactNode}) {
  const [access,setAccess] = useState<Access>()
  const [account,setAccount] = useState<Account|null>()
  const [error,setError] = useState('')
  const [route,setRoute] = useState(routeName)
  const checkAccount = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    const changed=()=>setRoute(routeName())
    window.addEventListener('hashchange',changed)
    return()=>window.removeEventListener('hashchange',changed)
  },[])
  useEffect(() => {
    if (!studioHost()) {
      setAccount(null);setAccess(localAccess);return
    }
    let stopped=false
    const check=async () => {
      try {
        const config=await fetch('/api/ui/public-config',{cache:'no-store'})
        const value:Access=config.status===404 ? localAccess : await config.json()
        if (!config.ok && config.status!==404) throw Error('Could not check your sign-in. Please retry.')
        let signedIn:Account|null=null
        if(value.accounts_required){
          const result=await fetch('/api/v1/accounts/me',{credentials:'same-origin',cache:'no-store'})
          if(result.ok) signedIn=await result.json()
          else if(result.status!==401) throw Error('Account storage is unavailable. Please retry.')
        }
        if(stopped)return
        setAccountIdentity(signedIn?.id || 'local')
        setAccount(signedIn);setAccess({...value,authenticated:!!signedIn});setError('')
      }catch(e){if(!stopped)setError(e instanceof Error?e.message:'Could not check your sign-in')}
    }
    checkAccount.current=check
    const changed=()=>{void check()}
    const storage=(e:StorageEvent)=>{if(e.key==='paramyth-account-change'){setAccount(undefined);changed()}}
    void check()
    window.addEventListener('focus',changed)
    window.addEventListener('storage',storage)
    window.addEventListener('paramyth-sign-in-required',changed)
    return()=>{stopped=true;window.removeEventListener('focus',changed);window.removeEventListener('storage',storage);window.removeEventListener('paramyth-sign-in-required',changed)}
  },[])
  const publicRoute=route==='' || route==='atlas'
  const authRoute=route==='signin' || route==='signup'
  // The public Atlas must remain usable while account storage is waking up.
  if(publicRoute)return <AccessContext.Provider value={access || {accounts_required:true,shared_keys:true,github_admin:false,authenticated:false}}><div key={account?.id||'local'}>{children}</div></AccessContext.Provider>
  if(error)return <><p className="account-notice" role="alert">{error} <button onClick={()=>location.reload()}>Retry</button></p><AccountPage signup={route==='signup'} available={false} onSignedIn={async()=>{}} /></>
  if(!access || account===undefined)return <main className="page"><p>Opening your workspace...</p></main>
  if(authRoute || (!publicRoute && (!studioHost() || access.accounts_required&&!account))) return <AccountPage key={route==='signup'?'signup':'signin'} signup={route==='signup'} available={studioHost()} onSignedIn={()=>checkAccount.current()} />
  return <AccessContext.Provider value={access}><div key={account?.id||'local'}>{account&&<div className="account-status" style={{padding:'8px 24px',display:'flex',gap:16,justifyContent:'flex-end'}}><span>Signed in as {account.display_name}</span><a href="/studio/teams.html">Account & sign out</a></div>}{children}</div></AccessContext.Provider>
}
