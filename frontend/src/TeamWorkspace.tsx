import { useEffect, useRef, useState } from 'react'
import { useDialogFocus } from './useDialogFocus'
import { api, projectPath } from './api'
import { useAccess } from './AccountGate'
import { useStudio } from './store'
import './teams.css'

export function WorkspacePicker(){
  const {teams=[],studio,openStudio}=useAccess()
  const {flush}=useStudio()
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  if(!teams.length)return null
  return <div className="team-workspace-picker"><label>Workspace<select aria-label="Project workspace" value={studio?.id||''} disabled={busy} onChange={async event=>{const id=event.target.value;setBusy(true);setError('');try{await flush();await openStudio?.(id)}catch(reason){setError(reason instanceof Error?reason.message:'Could not switch workspace')}finally{setBusy(false)}}}><option value="">My projects</option>{teams.map(team=><option key={team.id} value={team.id}>{team.name}{team.role==='viewer'?' · view only':''}</option>)}</select></label>{error&&<p role="alert">{error}</p>}</div>
}

export function ShareProject(){
  const {studio,teams=[],openStudio}=useAccess()
  const {project,flush}=useStudio()
  const choices=teams.filter(team=>team.role!=='viewer')
  const [open,setOpen]=useState(false),[team,setTeam]=useState(choices[0]?.id||''),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [changed,setChanged]=useState(false)
  const dialog=useRef<HTMLFormElement>(null)
  useDialogFocus(dialog,open,()=>setOpen(false),busy)
  if(studio || !project.id || !choices.length)return null
  return <><button className="secondary" onClick={()=>{setChanged(false);setOpen(true)}}>Share with team</button>{open&&<div className="modal-wrap" role="dialog" aria-modal="true" aria-labelledby="share-project-title"><button className="modal-scrim" tabIndex={-1} onClick={()=>!busy&&!changed&&setOpen(false)} aria-label="Close"/><form ref={dialog} className="modal" onChange={()=>setChanged(true)} onSubmit={async event=>{event.preventDefault();setBusy(true);setError('');try{await flush();const result=await api(`/api/ui/projects/${project.id}/share`,{studio_id:team});await openStudio?.(result.studio_id);location.hash='#/workflow?studio='+encodeURIComponent(result.studio_id)}catch(reason){setError(reason instanceof Error?reason.message:'Could not share project')}finally{setBusy(false)}}}><h2 id="share-project-title">Share {project.title}</h2><p>Create a shared copy with its writing, images, soundtracks and production files. Your personal original stays private.</p><label>Team<select required value={team} onChange={event=>setTeam(event.target.value)}>{choices.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{error&&<p role="alert">{error}</p>}<div className="modal-actions"><button type="button" disabled={busy} onClick={()=>setOpen(false)}>Cancel</button><button className="primary" disabled={busy}>{busy?'Sharing…':'Share & open workspace'}</button></div></form></div>}</>
}

type Comment={id:string;body:string;display_name:string;created_at:string}
export function TeamDiscussion(){
  const {studio}=useAccess()
  const {project}=useStudio()
  const [comments,setComments]=useState<Comment[]>([]),[body,setBody]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  useEffect(()=>{
    if(!studio || !project.id)return
    let active=true
    const load=()=>api(projectPath(`/api/ui/projects/${project.id}/discussion`,project.id)).then(value=>{if(active)setComments(value.comments)}).catch(reason=>{if(active)setError(reason.message)})
    void load();const interval=setInterval(()=>{if(!document.hidden)void load()},4000)
    return()=>{active=false;clearInterval(interval)}
  },[studio?.id,project.id])
  if(!studio || !project.id)return null
  return <details className="team-discussion"><summary>Team discussion{comments.length?' · '+comments.length:''}</summary>{comments.length?<ol>{comments.map(item=><li key={item.id}><strong>{item.display_name}</strong><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time><p>{item.body}</p></li>)}</ol>:<p>No comments yet.</p>}{studio.role!=='viewer'&&<form onSubmit={async event=>{event.preventDefault();setBusy(true);setError('');try{const item=await api(projectPath(`/api/ui/projects/${project.id}/discussion`,project.id),{body});setComments(rows=>[...rows,item]);setBody('')}catch(reason){setError(reason instanceof Error?reason.message:'Could not post comment')}finally{setBusy(false)}}}><label>Comment for your team<textarea value={body} onChange={event=>setBody(event.target.value)} maxLength={10000} required rows={3}/></label><button className="secondary" disabled={busy}>Post comment</button></form>}{error&&<p role="alert">{error}</p>}</details>
}

export function SharedConflicts(){
  const {conflicts,resolveConflicts}=useStudio()
  const [busy,setBusy]=useState(false)
  if(!conflicts.length)return null
  return <section className="shared-conflict" role="alert"><h2>A teammate saved changes</h2><p>Your edits are kept. Compare the versions before choosing which changes to save.</p>{conflicts.map(row=><details key={row.id+row.field}><summary>{row.field==='project'?'Project manuscript and brief':row.field}</summary><div className="shared-conflict-comparison"><div><strong>Your edits</strong><pre>{JSON.stringify(row.local,null,2)?.slice(0,6000)}</pre></div><div><strong>Teammate’s saved version</strong><pre>{JSON.stringify(row.remote,null,2)?.slice(0,6000)}</pre></div></div></details>)}<div className="modal-actions"><button disabled={busy} onClick={async()=>{setBusy(true);try{await resolveConflicts(false)}catch{}finally{setBusy(false)}}}>Use teammate’s changes</button><button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);try{await resolveConflicts(true)}catch{}finally{setBusy(false)}}}>Save my edits instead</button></div></section>
}
