import { useEffect, useState } from 'react'
import { backendFetch } from './api'
import { useAccess } from './AccountGate'
import { PageLoading } from './system-pages'

const requests = new Map<string, Promise<{id:string}>>()
export default function JoinTeam({token,accountId}:{token:string;accountId:string}) {
  const {openStudio}=useAccess()
  const [error,setError]=useState('')
  useEffect(()=>{
    if(!/^[A-Za-z0-9_-]{32,100}$/.test(token)){setError('This invitation link is incomplete. Ask the team owner for a new link.');return}
    let active=true
    const key=accountId+':'+token
    if(!requests.has(key))requests.set(key,backendFetch('/api/v1/invitations/accept',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),
    }).then(async response=>{const value=await response.json();if(!response.ok)throw Error(value.detail || 'Could not join this team.');return value}))
    requests.get(key)!.then(async studio=>{if(active)await openStudio?.(studio.id)}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'Could not join this team.')})
    return()=>{active=false}
  },[token,accountId,openStudio])
  return <main className="page" style={{margin:'0 auto',width:'100%',maxWidth:640,paddingTop:100}}>{error?<><h1>Join your team</h1><p role="alert">{error}</p><p>Use the email address that received the invitation.</p><a href={'#/signin?invite='+encodeURIComponent(token)}>Sign in with another account</a><p><a href="#/projects">Open your projects</a></p></>:<PageLoading label="Joining your team and opening its projects…" />}</main>
}
