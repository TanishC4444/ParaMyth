import { useEffect, useState } from 'react'
import { api, projectPath } from '../api'
import { useStudio } from '../store'
import { useAccess } from '../AccountGate'
import { TeamDiscussion } from '../TeamWorkspace'
import Library from './Library'

export default function SharedReader(){
  const {project,drafts}=useStudio(), {studio}=useAccess()
  const [sceneId,setScene]=useState(project.scenes[0]?.id||''),[records,setRecords]=useState<any[]>([])
  useEffect(()=>{let active=true;const load=()=>api(projectPath('/api/ui/creative',project.id)).then(value=>{if(active)setRecords(value.results)}).catch(()=>{});void load();window.addEventListener('studio-shared-update',load);return()=>{active=false;window.removeEventListener('studio-shared-update',load)}},[project.id])
  const scene=project.scenes.find(item=>item.id===sceneId)||project.scenes[0]
  const selected=drafts[project.id]?.['writing.versions']?.[scene?.id||'']
  const candidates=records.filter(item=>item.request?.scene_id===scene?.id && item.status==='complete' && item.result?.text)
  const record=candidates.find(item=>item.id===selected)||candidates[0]
  const edit=drafts[project.id]?.['writing.edits']?.[scene?.id||'']
  const text=edit?.base===(record?.id||'manuscript')?edit.text:record?.result?.text||scene?.content||''
  return <div className="page shared-reading"><h1>{project.title}</h1><p>{studio?.name} · View-only access</p><p>{project.brief.premise}</p><div className="toolbar"><label>Chapter<select aria-label="Shared chapter" value={scene?.id||''} onChange={event=>setScene(event.target.value)}>{project.scenes.map(item=><option key={item.id} value={item.id}>Chapter {item.chapter} · {item.title}</option>)}</select></label></div><textarea aria-label="Shared manuscript" readOnly value={text}/><TeamDiscussion /><Library /></div>
}
