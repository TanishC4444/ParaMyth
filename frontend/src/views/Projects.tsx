import { FormEvent, useEffect, useRef, useState } from "react";
import { manuscriptLabel, now, uid, validateBrief } from "../data";
import { useStudio, blankProject } from "../store";
import { EmptyState, errorText, Icon, PageTitle, Status } from "../ui";
import { MEDIA, type Brief, type Medium, type Project, type Scene } from "../types";
import { ProjectCover } from "../brandArt";
import { useAccess } from '../AccountGate';
import { useDialogFocus } from '../useDialogFocus';

/** Same keyword detection idea as the backend selector: an explicit medium wins, otherwise premise words decide. */
const detectMedium = (premise: string): Medium | null => {
  const p = premise.toLowerCase();
  if (/screenplay|film|movie/.test(p)) return "Screenplay";
  if (/stage play|theatre|theater/.test(p)) return "Stage play";
  if (/radio|podcast|audio drama/.test(p)) return "Audio drama";
  if (/comic|graphic novel|panel/.test(p)) return "Comic script";
  if (/short story/.test(p)) return "Short story";
  return null;
};

export default function Projects() {
  const {studio}=useAccess();
  const { store, selectProject } = useStudio();
  const [q, setQ] = useState(""), [medium, setMedium] = useState("All"), [state, setState] = useState("All"), [mode, setMode] = useState<"grid" | "list">("grid"), [create, setCreate] = useState(false);
  const result = store.projects.filter((p) => p.title.toLowerCase().includes(q.toLowerCase()) && (medium === "All" || p.brief.medium === medium) && (state === "All" || manuscriptLabel(p) === state));
  return <div className="page">
    <PageTitle eyebrow="WORKSPACE" title="Projects" text={studio ? "Your team’s writing, visuals and production, organized by story." : "A dedicated workspace for every story you’re developing."}>{studio?.role!=='viewer'&&<button className="primary" onClick={() => setCreate(true)}><Icon name="plus" />New project</button>}</PageTitle>
    <div className="toolbar">
      <label><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects" aria-label="Search projects" /></label>
      <select aria-label="Medium" value={medium} onChange={(e) => setMedium(e.target.value)}><option value="All">All formats</option>{MEDIA.map((m) => <option key={m}>{m}</option>)}</select>
      <select aria-label="Manuscript state" value={state} onChange={(e) => setState(e.target.value)}><option value="All">All statuses</option><option>Partial</option><option>Provisional</option><option>Final</option></select>
      <div className="mode-buttons"><button aria-label="Grid view" aria-pressed={mode === "grid"} className={mode === "grid" ? "selected" : ""} onClick={() => setMode("grid")}><Icon name="grid" /></button><button aria-label="List view" aria-pressed={mode === "list"} className={mode === "list" ? "selected" : ""} onClick={() => setMode("list")}><Icon name="list" /></button></div>
    </div>
    {result.length ? <div className={mode === "grid" ? "project-grid" : "project-grid list-mode"}>{result.map((p) => <button className="project-card" onClick={() => selectProject(p.id)} key={p.id}>
      <div className="project-cover illustrated-cover"><ProjectCover project={p} /><span>{p.brief.medium}</span></div>
      <div className="project-card-body"><div><Status>{manuscriptLabel(p)}</Status><span>{p.brief.genre}</span></div><h3>{p.title}</h3><p>{p.owner} · {p.scenes.length} scenes · {p.canon.length} canon facts</p></div>
    </button>)}</div> : <EmptyState icon={store.projects.length ? "search" : "projects"} title={store.projects.length ? "No projects match your filters" : "Your first project starts here"} text={store.projects.length ? "Try another search or reset the format and status filters." : "Give your story a title and a short premise. Everything you create will have a place to belong."} action={store.projects.length ? <button className="secondary" onClick={() => { setQ(""); setMedium("All"); setState("All"); }}>Clear filters</button> : studio?.role !== "viewer" ? <button className="primary" onClick={() => setCreate(true)}><Icon name="plus" size={17} />Create a project</button> : undefined} />}
    {create && <CreateProjectDialog close={() => setCreate(false)} />}
  </div>;
}

export function CreateProjectDialog({ close }: { close: () => void }) {
  const { createProject, selectProject, notify } = useStudio();
  const [premise, setPremise] = useState(""), [medium, setMedium] = useState<Medium | "Detect">("Detect"), [errors, setErrors] = useState<string[]>([]), [busy,setBusy]=useState(false);
  const dialog = useRef<HTMLFormElement>(null);
  useDialogFocus(dialog,true,close,busy);
  const [changed,setChanged]=useState(false);
  const detected = detectMedium(premise);
  const go = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if(busy)return;
    const d = new FormData(e.currentTarget);
    const chapters = Number(d.get("chapters")), per = Number(d.get("scenes"));
    const brief: Brief = { ...blankProject().brief, premise, medium: medium === "Detect" ? detected || "Novel" : medium, genre: String(d.get("genre")), tone: String(d.get("tone")), chapters, scenesPerChapter: per, wordMin: Number(d.get("wmin")), wordMax: Number(d.get("wmax")), characters: [], themes: [], worldRules: [], mustAvoid: [] };
    const errs = validateBrief(brief);
    setErrors(errs);
    if (errs.length) return;
    const scenes: Scene[] = Array.from({ length: chapters * per }, (_, i) => ({ id: uid(), chapter: Math.floor(i / per) + 1, title: `Scene ${i + 1}`, pov: "", location: "", content: "", state: "Draft", findings: [], minutes: 4, night: false }));
    const project: Project = { id: uid(), title: String(d.get("title")), owner: "You", color: ["mint", "peach", "gold"][Math.floor(Math.random() * 3)], updated: now(), brief, scenes, canon: [], versions: [] };
    setBusy(true);
    try { const saved = await createProject(project); selectProject(saved.id, "brief"); close(); notify("Project saved to your studio"); } catch (error) { setErrors([errorText(error)]); } finally {setBusy(false)}
  };
  return <div className="modal-wrap" role="dialog" aria-modal="true" aria-labelledby="create-project-title"><button className="modal-scrim" tabIndex={-1} disabled={busy} onClick={()=>{if(!changed)close()}} aria-label="Close" />
    <form ref={dialog} className="modal wide" onChange={()=>setChanged(true)} onSubmit={go}><button type="button" className="modal-close" disabled={busy} onClick={close} aria-label="Close"><Icon name="close" /></button>
      <span className="eyebrow">NEW PROJECT</span><h2 id="create-project-title">Start with a story.</h2><p>Start with the basics. You can add characters, world rules and constraints on the Brief tab later.</p>
      <label>Title<input name="title" required placeholder="e.g. The Ferryman's Ledger" /></label>
      <label>Premise<textarea required value={premise} onChange={(e) => setPremise(e.target.value)} placeholder="One or two sentences: who wants what, and what stands in the way." /></label>
      <label>Medium<select value={medium} onChange={(e) => setMedium(e.target.value as Medium | "Detect")}><option value="Detect">Detect from premise{detected ? ` (${detected})` : " (Novel)"}</option>{MEDIA.map((m) => <option key={m}>{m}</option>)}</select></label>
      <div className="form-grid"><label>Genre<input name="genre" defaultValue="Literary" /></label><label>Tone<input name="tone" defaultValue="Restrained" /></label>
        <label>Chapters<input name="chapters" type="number" min={1} max={40} defaultValue={3} /></label><label>Scenes per chapter<input name="scenes" type="number" min={1} max={12} defaultValue={2} /></label>
        <label>Min words / scene<input name="wmin" type="number" defaultValue={800} /></label><label>Max words / scene<input name="wmax" type="number" defaultValue={1200} /></label></div>
      {errors.length > 0 && <ul className="errors">{errors.map((x) => <li key={x}>{x}</li>)}</ul>}
      <div className="modal-actions"><button type="button" disabled={busy} onClick={close}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Creating project…" : "Create project"} <Icon name="arrow" /></button></div>
    </form></div>;
}
