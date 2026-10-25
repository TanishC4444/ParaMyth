import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { setAccountIdentity } from './api'

type Account = { id: string; email: string; display_name: string }
type Access = { accounts_required: boolean; shared_keys: boolean; github_admin: boolean }
const AccessContext = createContext<Access>({accounts_required:false, shared_keys:false, github_admin:true})
export const useAccess = () => useContext(AccessContext)

export default function AccountGate({children}: {children:ReactNode}) {
  const [access,setAccess] = useState<Access>()
  const [account,setAccount] = useState<Account|null>()
  const [error,setError] = useState('')
  useEffect(() => {
    let stopped=false
    const check=async () => {
      try {
        const config=await fetch('/api/ui/public-config',{cache:'no-store'})
        const value:Access=config.status===404 ? {accounts_required:false,shared_keys:false,github_admin:true} : await config.json()
        if (!config.ok && config.status!==404) throw Error('Could not check your sign-in. Please retry.')
        let signedIn:Account|null=null
        if(value.accounts_required){
          const result=await fetch('/api/v1/accounts/me',{credentials:'same-origin',cache:'no-store'})
          if(result.ok) signedIn=await result.json()
          else if(result.status!==401) throw Error('Account storage is unavailable. Please retry.')
        }
        if(stopped)return
        setAccountIdentity(signedIn?.id || 'local')
        setAccount(signedIn);setAccess(value);setError('')
      }catch(e){if(!stopped)setError(e instanceof Error?e.message:'Could not check your sign-in')}
    }
    const changed=()=>{void check()}
    const storage=(e:StorageEvent)=>{if(e.key==='paramyth-account-change'){setAccount(undefined);changed()}}
    void check()
    window.addEventListener('focus',changed)
    window.addEventListener('storage',storage)
    window.addEventListener('paramyth-sign-in-required',changed)
    return()=>{stopped=true;window.removeEventListener('focus',changed);window.removeEventListener('storage',storage);window.removeEventListener('paramyth-sign-in-required',changed)}
  },[])
  if(error)return <main className="page"><h1>We couldn’t open your workspace</h1><p role="alert">{error}</p><button onClick={()=>location.reload()}>Retry</button></main>
  if(!access || account===undefined)return <main className="page"><p>Opening your workspace…</p></main>
  if(access.accounts_required&&!account)return <main className="page"><h1>Your stories, saved for you.</h1><p>Sign in to return to your projects, drafts, images, music, and production plans.</p><div className="inline-links"><a className="primary" style={{color:"#fff"}} href="/studio/teams.html">Sign in</a><a className="secondary" href="/studio/teams.html?mode=signup">Create account</a></div></main>
  return <AccessContext.Provider value={access}><div key={account?.id||'local'}>{account&&<div className="account-status" style={{padding:'8px 24px',display:'flex',gap:16,justifyContent:'flex-end'}}><span>Signed in as {account.display_name}</span><a href="/studio/teams.html">Account & sign out</a></div>}{children}</div></AccessContext.Provider>
}
