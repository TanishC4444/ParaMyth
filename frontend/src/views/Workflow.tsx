import { useEffect } from "react";
import { useDraftState, useStudio } from "../store";
import { useMaterials } from "../materials";
import WritingWorkspace from "./WritingWorkspace";
import Images from "./Images";
import Music from "./Music";
import Production from "./Production";
import ProjectWorkspace from "./ProjectWorkspace";
import "../workflow.css";
import { ShareProject, TeamDiscussion } from '../TeamWorkspace';
import { useAccess } from '../AccountGate';
import SharedReader from './SharedReader';

export default function Workflow() {
  const {studio}=useAccess();
  const {project,jobs,go,setTab}=useStudio();
  const {writing,images,source,setSource,sourceTitle,current,streaming}=useMaterials();
  const initial=location.hash.split('?')[0].split('/').at(-1);
  const [section,setSection]=useDraftState('workflow.section',['images','music','production'].includes(initial || '')?'media':'writing');
  const [tool,setTool]=useDraftState('workflow.tool',['images','music','production'].includes(initial || '')?initial!:'images');
  const [pane,setPane]=useDraftState('workflow.writing','creative');
  const active=jobs.filter(j=>['running','queued'].includes(j.status));
  useEffect(()=>{if(pane==='brief')setTab('brief');else if(pane==='manuscript')setTab('manuscript');},[pane]);
  // A link straight to #/images, #/music or #/production opens that tool, even when another tab was saved last.
  useEffect(()=>{if(['images','music','production'].includes(initial||'')){setSection('media');setTool(initial!);}},[]);
  if(studio?.role==='viewer')return <SharedReader />;
  return <div className="page project-workflow two-tab-workflow">
    <header className="workflow-heading"><div><h1>{project.title}</h1><p>{studio?studio.name+' · Shared with your team. Saved changes update automatically.':'Your story and everything you make from it, saved together.'}</p></div><div className="modal-actions"><ShareProject /><button className="secondary" onClick={()=>go('projects')}>Change project</button></div></header>
    <TeamDiscussion />
    <nav className="workflow-primary-tabs" aria-label="Project workflow tabs"><button aria-pressed={section==='writing'} onClick={()=>setSection('writing')}>Writing</button><button aria-pressed={section==='media'} onClick={()=>setSection('media')}>Visuals, sound & production</button>{active.length>0&&<span role="status">{active.length} running</span>}</nav>
    <section hidden={section!=='writing'} aria-label="Writing workspace">
      <nav className="workflow-tabs writing-subtabs" aria-label="Writing views">{[['creative','Write chapters'],['brief','Project brief'],['manuscript','Manuscript & versions']].map(([id,label])=><button key={id} aria-pressed={pane===id} onClick={()=>setPane(id)}>{label}</button>)}</nav>
      <div hidden={pane!=='creative'}><WritingWorkspace /></div><div hidden={pane==='creative'} className="workflow-manuscript-tools"><ProjectWorkspace /></div>
    </section>
    <section hidden={section!=='media'} aria-label="Media and production workspace">
      <section className="workflow-source" aria-label="Shared project materials"><label>Working from<select aria-label="Writing used by visuals, sound and planning" value={source} onChange={e=>setSource(e.target.value)}><option value="latest">Follow latest writing · live</option><option value="working">Idea editor text</option><option value="manuscript">Saved manuscript</option>{writing.map(r=><option key={r.id} value={r.id}>{r.title}{r.status==='running'?' · writing now':''}</option>)}</select></label><span>{images.length} saved visuals</span><span role="status">{streaming?'Draft updating live':sourceTitle}</span></section>
      {current && <details className="live-writing-context"><summary>{streaming?'Writing now':'Current source'} · {current.words.toLocaleString()} words</summary><p>{current.excerpt || 'This chapter is still blank. New requests use your project brief and earlier chapters.'}</p><small>New requests use this writing. Finished work stays saved; update it when you want a newer version.</small></details>}
      <nav className="workflow-tabs" aria-label="Create and plan">{[['images','Visuals'],['music','Soundtracks'],['production','Production']].map(([id,label])=><button key={id} aria-pressed={tool===id} onClick={()=>setTool(id)}>{label}{jobs.some(j=>['queued','running'].includes(j.status)&&(id==='images'?j.kind.startsWith('image'):j.kind===id))&&<i aria-label="Running"/>}</button>)}</nav>
      <div hidden={tool!=='images'}><Images /></div><div hidden={tool!=='music'}><Music /></div><div hidden={tool!=='production'}><Production /></div>
    </section>
  </div>;
}
