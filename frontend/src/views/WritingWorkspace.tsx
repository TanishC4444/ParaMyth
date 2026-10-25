import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, projectPath, studioJobs, type Job } from "../api";
import { useDraftState, useStudio } from "../store";
import { uid, now } from "../data";
import type { Scene } from "../types";
import { errorText } from "../ui";
import Creative from "./Creative";

type Written = { id: string; status: string; request: { chapter?: number; scene_id?: string }; result?: { title?: string; text?: string }; preview?: Job["preview"]; error?: string };
type Edit = { base: string; title: string; text: string };
const pending = (job: Job) => ["queued", "running"].includes(job.status);
const blank = (chapter: number): Scene => ({ id: `chapter-${chapter}`, chapter, title: `Chapter ${chapter}`, content: "", pov: "", location: "", state: "Draft", findings: [], minutes: 4, night: false });

export default function WritingWorkspace() {
  const { project, ready, updateProject, flush, notify, go } = useStudio();
  const [chapter, setChapter] = useDraftState("writing.chapter", 1);
  const [sceneIds, setSceneIds] = useDraftState<Record<string, string>>("writing.sceneIds", {});
  const [edits, setEdits] = useDraftState<Record<string, Edit>>("writing.edits", {});
  const [directions, setDirections] = useDraftState<Record<string, string>>("writing.directions", {});
  const [length, setLength] = useDraftState("writing.words", 1000);
  const ideaKey=chapter===1 ? "creative" : `creative.chapter${chapter}`;
  const [idea] = useDraftState(`${ideaKey}.input`, "");
  const [suggestions] = useDraftState<{aspect?:string;answer?:string}[]>(`${ideaKey}.inlineSuggestions`, []);
  const [revisions,setRevisions] = useDraftState<Record<string,string>>("writing.revisions", {});
  const [passages,setPassages] = useDraftState<Record<string,string>>("writing.passages", {});
  const [reviews,setReviews] = useDraftState<Record<string,any>>("writing.reviews", {});
  const [handle, setHandle] = useDraftState<string>("writing.job", "");
  const [versions, setVersions] = useDraftState<Record<string, string>>("writing.versions", {});
  const [records, setRecords] = useState<Written[]>([]);
  const [live, setLive] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const generationProject = useRef(project.id); generationProject.current = project.id;
  const chapterScenes = project.scenes.filter(s => s.chapter === chapter);
  const scene = chapterScenes.find(s => s.id === sceneIds[chapter]) || chapterScenes[0] || blank(chapter);
  const sceneRecords = records.filter(r => r.request.scene_id === scene.id);
  const record = sceneRecords.find(r => r.id === versions[scene.id]) || sceneRecords[0];
  const base = record?.id || "manuscript";
  const draft = edits[scene.id]?.base === base ? edits[scene.id] : { base, title: record?.result?.title || record?.preview?.title || scene.title, text: record?.result?.text || record?.preview?.text || scene.content };
  const streaming = live && pending(live) && live.preview?.scene_id === scene.id && ["Draft","Revise"].includes(live.preview?.stage || "");
  const busy = submitting || !!handle;
  const chapters = [...new Set([1, chapter, ...project.scenes.map(s => s.chapter), ...records.map(r => r.request.chapter || 1)])].sort((a,b) => a-b);
  const path = (p: string) => projectPath(p, project.id);
  const edit = (patch: Partial<Edit>) => setEdits(v => ({ ...v, [scene.id]: { ...draft, ...patch } }));

  useEffect(()=>{if(ready && project.id){setChapter(chapter);setSceneIds(v=>({...v,[chapter]:scene.id}));}},[project.id,ready,chapter,scene.id]);

  useEffect(() => {
    let active = true;
    setRecords([]); setLive(null); setError(""); setSubmitting(false);
    const load = async () => {
      if (!project.id || !ready) return;
      try {
        const [saved, jobs] = await Promise.all([api<{results: Written[]}>(projectPath('/api/ui/creative',project.id)),studioJobs(project.id)]);
        if (!active) return;
        setRecords(saved.results.filter(r => !!r.request.chapter));
        const running = jobs.find(j => pending(j) && !!j.preview?.chapter);
        if (running) { setHandle(running.id); setLive(running); }
      } catch (e) { if (active) setError(errorText(e)); }
    };
    void load(); window.addEventListener('studio-refresh',load); window.addEventListener('studio-shared-update',load);
    return () => { active = false; window.removeEventListener('studio-refresh',load); window.removeEventListener('studio-shared-update',load); };
  }, [project.id,ready]);

  useEffect(() => {
    if (!handle || !project.id) return;
    let active = true;
    const events = new EventSource(projectPath(`/api/ui/creative/jobs/${handle}/events`,project.id), { withCredentials: true });
    events.addEventListener('progress', event => {
      if (!active) return;
      const job = JSON.parse((event as MessageEvent).data) as Job;
      setLive(job); setError("");
      window.dispatchEvent(new CustomEvent('studio-writing-progress',{ detail: { projectId: project.id } }));
      if (!pending(job)) {
        events.close(); setHandle("");
        if (job.result?.request?.operation === 'review') setReviews(v=>({...v,[job.result.request.scene_id]:{...job.result.result,text:job.result.request.text}}));
        else if (job.result) setRecords(rows => [job.result, ...rows.filter(r => r.id !== job.result.id)]);
        if (job.status !== 'complete') setError(job.message || 'Writing stopped. Your partial draft is saved.');
        window.dispatchEvent(new Event('studio-refresh'));
      }
    });
    events.onerror = () => { if (active) setError('Reconnecting to your saved writing. This will not start another request.'); };
    return () => { active = false; events.close(); };
  }, [handle,project.id]);

  const run = async (operation: 'draft' | 'revise' | 'review') => {
    if (busy || !project.id) return;
    const id = project.id;
    setSubmitting(true); setError("");
    try {
      if (!project.scenes.some(s => s.id === scene.id)) updateProject(id,p => ({ scenes: [...p.scenes,scene], brief: {...p.brief,chapters:Math.max(p.brief.chapters,chapter)} }));
      await flush();
      const job = await api<{job_id:string}>(projectPath('/api/ui/creative',id), {
        operation, chapter:operation==='review'?0:chapter, context_chapter:chapter, scene_id:scene.id, words:length, use_story:true,
        brief:[idea || project.brief.premise, ...suggestions.filter(s=>s.answer?.trim()).map(s=>`${s.aspect || 'Author detail'}: ${s.answer}`), directions[scene.id] || '', chapterScenes.length > 1 ? `Write only scene ${chapterScenes.indexOf(scene)+1} of chapter ${chapter}. Other scenes remain separate.` : 'Write this chapter as a complete narrative unit.'].filter(Boolean).join('\n\n'),
        text:operation !== 'draft' ? draft.text : '', target_passage:operation==='revise' ? passages[scene.id]?.trim() || '' : '', feedback:[revisions[scene.id] || 'Suggest or apply specific improvements to clarity, character choices, pacing and continuity while preserving the story.', passages[scene.id]?.trim() ? `Limit changes to this passage; preserve the rest of the chapter verbatim. Use the following passage as the revision scope:\n${passages[scene.id]}` : ''].filter(Boolean).join('\n\n'),
      });
      if (generationProject.current === id) { setHandle(job.job_id); if(operation!=='review')setVersions(v => ({...v,[scene.id]:''})); setLive({ id:job.job_id,kind:'creative',project_id:id,status:'queued',message:'Preparing your chapter…',created_at:new Date().toISOString(),preview:{record_id:'',stage:operation==='review'?'Review':operation==='revise'?'Revise':'Draft',chapter,scene_id:scene.id,text:''} }); }
      window.dispatchEvent(new Event('studio-refresh'));
    } catch (e) { if (generationProject.current === id) setError(errorText(e)); }
    finally { if (generationProject.current === id) setSubmitting(false); }
  };
  const save = async (advance: boolean, forceNew = false) => {
    if ((!draft.text.trim() && !forceNew) || busy || saving) return;
    setSaving(true); setError("");
    const index = chapterScenes.findIndex(s => s.id === scene.id);
    const nextScene = forceNew ? undefined : chapterScenes[index+1];
    const nextChapter = forceNew ? Math.max(...chapters)+1 : nextScene ? chapter : chapters.find(n => n > chapter) || chapter+1;
    if (advance && nextChapter > 100) { setSaving(false); setError('This project supports up to 100 chapters.'); return; }
    const next = nextScene || project.scenes.find(s => s.chapter === nextChapter) || blank(nextChapter);
    const saved: Scene = {...scene,title:draft.title,content:draft.text,state:'Draft',acceptedHash:undefined};
    try {
      updateProject(project.id,p => ({
        versions:[...p.versions,{id:uid(),label:`Before saving chapter ${chapter}`,created:now(),scenes:p.scenes}],
        scenes:[...(p.scenes.some(s => s.id === scene.id) ? p.scenes.map(s => s.id === scene.id ? saved : s) : [...p.scenes,saved]),...(advance && !p.scenes.some(s => s.id === next.id) ? [next] : [])].sort((a,b) => a.chapter-b.chapter),
        brief:{...p.brief,chapters:Math.max(p.brief.chapters,advance ? nextChapter : chapter)},
      }));
      await flush();
      if (advance) { setChapter(nextChapter); setSceneIds(v => ({...v,[nextChapter]:next.id})); }
      window.dispatchEvent(new Event('studio-refresh'));
      notify(advance ? 'Saved. Your next chapter or scene is ready.' : 'Chapter saved to your manuscript.');
    } catch (e) { setError(errorText(e)); }
    finally { setSaving(false); }
  };

  return <div className="writing-studio-grid">
    <section className="writing-direction" aria-label="Ideas and revision direction">
      <Creative key={`${project.id}:${chapter}`} ideasOnly chapter={chapter} sceneId={scene.id} onStart={()=>void run('draft')} writingBusy={busy} />
      <section className="panel chapter-direction">
        <h2>Direction for chapter {chapter}</h2>
        <label className="field">Chapter direction · optional<textarea value={directions[scene.id] || ''} onChange={e => setDirections(v => ({...v,[scene.id]:e.target.value}))} placeholder="Add a scene idea, ask for a revision, or leave this blank and we’ll continue the story." maxLength={6000} /></label>
        <details><summary>Chapter length</summary><label className="field">Around {length} words<input type="range" min={100} max={3000} step={100} value={length} onChange={e => setLength(Number(e.target.value))} /></label></details>
        <div className="comment-actions"><button className="primary" disabled={!ready || !project.id || busy} onClick={() => void run('draft')}>{busy ? 'Writing…' : chapterScenes.length > 1 ? 'Write this scene' : 'Write this chapter'}</button></div>
        <p className="hint">Earlier chapters guide continuity, including your latest edits. Blank details are filled in for you.</p>
      </section>
    </section>
    <section className="panel chapter-manuscript" aria-label="Chapter writing">
      <div className="chapter-toolbar"><label>Chapter<select aria-label="Current chapter" value={chapter} onChange={e => setChapter(Number(e.target.value))}>{chapters.map(n => <option key={n} value={n}>Chapter {n}</option>)}</select></label><button disabled={busy || saving || Math.max(...chapters)>=100} onClick={() => void save(true,true)}>New chapter</button></div>
      {chapterScenes.length > 1 && <label className="field">Scene in this chapter<select value={scene.id} onChange={e => setSceneIds(v => ({...v,[chapter]:e.target.value}))}>{chapterScenes.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>}
      {error && <p className="live-status error" role="alert">{error}</p>}
      {!!handle && <p className="live-status" role="status">{live?.message || 'Writing continues in the background.'} <button onClick={() => go('images')}>Work on visuals & production</button></p>}
      {sceneRecords.length>1 && <label className="field">Draft version<select value={record?.id || ''} onChange={e => setVersions(v => ({...v,[scene.id]:e.target.value}))}>{sceneRecords.map((r,i) => <option key={r.id} value={r.id}>{i===0 ? 'Latest draft' : `Earlier draft ${sceneRecords.length-i}`} · {r.status}</option>)}</select></label>}
      {streaming ? <><h2>{live.preview?.title || `Chapter ${chapter}`}</h2><ChapterStream text={live.preview?.text || 'Waiting for the first words…'} /></> : <>
        {record && record.status !== 'complete' && <p className="hint">Unfinished draft. You can keep this partial writing or try generating again.</p>}
        <input className="chapter-title" aria-label="Chapter title" value={draft.title} onChange={e => edit({title:e.target.value})} />
        <textarea className="chapter-editor" aria-label="Chapter manuscript" value={draft.text} onChange={e => edit({text:e.target.value})} placeholder="Your chapter will appear here as it is written. You can also write or edit it yourself." />
      </>}
      {!!draft.text.trim() && !streaming && <section className="chapter-revisions" aria-label="Chapter revisions">
        <h3>Revise chapter {chapter}</h3>
        <label className="field">What would you like to change?<textarea value={revisions[scene.id] || ''} maxLength={6000} onChange={e=>setRevisions(v=>({...v,[scene.id]:e.target.value}))} placeholder="For example: give the dialogue more tension, or make the ending quieter." /></label>
        <details><summary>Revise a specific passage</summary><label className="field">Passage to revise<textarea value={passages[scene.id] || ''} maxLength={10000} onChange={e=>setPassages(v=>({...v,[scene.id]:e.target.value}))} placeholder="Paste the passage you want changed. Leave blank to revise the whole chapter." /></label></details>
        <div className="comment-actions"><button disabled={busy} onClick={()=>void run('review')}>Suggest revisions</button><button className="primary" disabled={busy} onClick={()=>void run('revise')}>Apply revisions</button></div>
        {reviews[scene.id] && <div className="chapter-review"><p>{reviews[scene.id].summary}</p>{reviews[scene.id].text!==draft.text && <p className="hint">This feedback is from an earlier draft. You can request a fresh review.</p>}{(reviews[scene.id].issues || []).map((issue:any,i:number)=><article key={i}><b>{issue.problem}</b>{issue.quote && <blockquote>{issue.quote}</blockquote>}<p>{issue.fix}</p><button onClick={()=>{setRevisions(v=>({...v,[scene.id]:[v[scene.id],issue.fix].filter(Boolean).join('\n')}));if(issue.quote)setPassages(v=>({...v,[scene.id]:issue.quote}));}}>Use this revision</button></article>)}</div>}
      </section>}
      <div className="chapter-footer"><span>{(streaming ? live.preview?.text || '' : draft.text).trim().split(/\s+/).filter(Boolean).length} words · Edits save automatically</span><div className="comment-actions"><button disabled={busy || saving || !draft.text.trim()} onClick={() => void save(false)}>Save to manuscript</button><button className="primary" disabled={busy || saving || !draft.text.trim()} onClick={() => void save(true)}>Save & next {chapterScenes.indexOf(scene)<chapterScenes.length-1 ? 'scene' : 'chapter'} →</button></div></div>
    </section>
  </div>;
}

function ChapterStream({text}:{text:string}) {
  const box=useRef<HTMLPreElement>(null);
  const following=useRef(true);
  const [paused,setPaused]=useState(false);
  const latest=()=>{following.current=true;setPaused(false);if(box.current)box.current.scrollTop=box.current.scrollHeight;};
  useLayoutEffect(()=>{if(following.current && box.current?.getClientRects().length)box.current.scrollTop=box.current.scrollHeight;},[text]);
  return <div className="chapter-stream-wrap"><pre ref={box} className="chapter-stream" tabIndex={0} aria-label="Chapter being written" onScroll={()=>{const el=box.current;if(!el?.getClientRects().length)return;following.current=el.scrollHeight-el.scrollTop-el.clientHeight<60;setPaused(!following.current);}}>{text}<span className="writing-cursor" aria-hidden="true" /></pre>{paused && <button className="chapter-follow" onClick={latest}>Jump to latest</button>}</div>;
}
