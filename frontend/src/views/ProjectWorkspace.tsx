import {api} from "../api";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { download, hash, manuscriptLabel, mechanicalReview, MODES, modeOf, now, slug, uid, validateBrief, words } from "../data";
import { useStudio, useDraftState } from "../store";
import { FACT_KINDS, MEDIA, type Brief, type Character, type Dimension, type Fact, type FactKind, type Finding, type Project, type ProjectTab, type Scene } from "../types";
import { ago, Chips, errorText, fmtTime, Icon, Segmented, Status } from "../ui";

const TABS: [ProjectTab, string][] = [["brief", "Brief"], ["manuscript", "Manuscript"], ["canon", "Canon & memory"], ["pipeline", "Pipeline"]];

export default function ProjectWorkspace({ embedded = false }: { embedded?: boolean }) {
  const { project, go } = useStudio();
  const [tab, setTab] = useDraftState<ProjectTab>("project.tab", "brief");
  return <div className={`workspace${embedded ? " embedded-workspace" : ""}`}>
    {!embedded && <div className="editor-top">
      <button className="back" onClick={() => go("projects")}>‹ <span>Projects</span></button>
      <div><b>{project.title}</b><small>{project.brief.medium} · updated {ago(project.updated)}</small></div>
      <div className="tabs" role="tablist">{TABS.map(([id, label]) => <button role="tab" aria-selected={tab === id} key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</div>
    </div>}
    {tab === "brief" && <BriefTab />}
    {tab === "manuscript" && <ManuscriptTab />}
    {tab === "canon" && <CanonTab />}
    {tab === "pipeline" && <PipelineTab />}
  </div>;
}

function BriefTab() {
  const { project, updateProject, notify, flush } = useStudio();
  const b = project.brief;
  const set = (patch: Partial<Brief>) => updateProject(project.id, { brief: { ...b, ...patch } });
  const errors = validateBrief(b);
  const setChar = (id: string, patch: Partial<Character>) => set({ characters: b.characters.map((c) => c.id === id ? { ...c, ...patch } : c) });
  return <div className="page brief-page">
    <div className="brief-grid">
      <section className="panel"><h2>Story</h2>
        <label className="field">Premise<textarea value={b.premise} onChange={(e) => set({ premise: e.target.value })} /></label>
        <div className="form-grid">
          <label className="field">Medium<select value={b.medium} onChange={(e) => set({ medium: e.target.value as Brief["medium"] })}>{MEDIA.map((m) => <option key={m}>{m}</option>)}</select></label>
          <label className="field">Genre<input value={b.genre} onChange={(e) => set({ genre: e.target.value })} /></label>
          <label className="field">Tone<input value={b.tone} onChange={(e) => set({ tone: e.target.value })} /></label>
          <label className="field">Point of view<input value={b.pov} onChange={(e) => set({ pov: e.target.value })} /></label>
        </div>
        <p className="hint">{mediumHint[b.medium]}</p>
      </section>
      <section className="panel"><h2>Structure</h2>
        <div className="form-grid">
          <label className="field">Chapters<input type="number" value={b.chapters} onChange={(e) => set({ chapters: Number(e.target.value) })} /></label>
          <label className="field">Scenes per chapter<input type="number" value={b.scenesPerChapter} onChange={(e) => set({ scenesPerChapter: Number(e.target.value) })} /></label>
          <label className="field">Min words<input type="number" value={b.wordMin} onChange={(e) => set({ wordMin: Number(e.target.value) })} /></label>
          <label className="field">Max words<input type="number" value={b.wordMax} onChange={(e) => set({ wordMax: Number(e.target.value) })} /></label>
        </div>
        <div className="field">Scene length<Segmented label="Scene length" value={b.lengthMode} options={["Guided", "Strict"] as const} onChange={(lengthMode) => set({ lengthMode })} /></div>
        {errors.length ? <ul className="errors">{errors.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="ok"><Icon name="check" size={15} />Brief looks good.</p>}
        <button className="secondary" onClick={async () => {try{await flush();const brief=await api(`/api/ui/projects/${project.id}/request`);download(`${slug(project.title)}-brief.json`,JSON.stringify(brief,null,2),"application/json");notify("Runner brief downloaded")}catch(e){notify(errorText(e))}}}><Icon name="download" />Export brief JSON</button>
      </section>
      <section className="panel"><h2>World</h2>
        <div className="field">Themes<Chips items={b.themes} onChange={(themes) => set({ themes })} placeholder="Add theme, press Enter" /></div>
        <div className="field">Fixed world rules<Chips items={b.worldRules} onChange={(worldRules) => set({ worldRules })} placeholder="Add rule, press Enter" /></div>
        <div className="field">Must avoid<Chips items={b.mustAvoid} onChange={(mustAvoid) => set({ mustAvoid })} placeholder="Add constraint, press Enter" /></div>
      </section>
    </div>
    <section className="section"><div className="section-head"><h2>Cast</h2><button className="text-action" onClick={() => set({ characters: [...b.characters, { id: uid(), name: "", goal: "", fear: "", voice: "", arc: { belief: "", pressure: "", choice: "", change: "" } }] })}><Icon name="plus" size={15} />Add character</button></div>
      <div className="cast-grid">{b.characters.map((c) => <article className="panel character" key={c.id}>
        <input className="char-name" aria-label="Character name" placeholder="Name" value={c.name} onChange={(e) => setChar(c.id, { name: e.target.value })} />
        {(["goal", "fear", "voice"] as const).map((k) => <label className="field" key={k}>{k[0].toUpperCase() + k.slice(1)}<input value={c[k]} onChange={(e) => setChar(c.id, { [k]: e.target.value })} /></label>)}
        <div className="arc">{(["belief", "pressure", "choice", "change"] as const).map((k, i) => <label key={k}><small>{i + 1} · {k === "belief" ? "Starting belief" : k === "choice" ? "Costly choice" : k === "change" ? "Possible change" : "Pressure"}</small><textarea value={c.arc[k]} onChange={(e) => setChar(c.id, { arc: { ...c.arc, [k]: e.target.value } })} /></label>)}</div>
        <button className="secondary character-delete" aria-label={`Delete character ${c.name || 'unnamed'}`} onClick={() => { set({ characters: b.characters.filter((x) => x.id !== c.id) }); notify(`${c.name || 'Character'} removed from the brief`); }}>Delete character</button>
      </article>)}{!b.characters.length && <p className="quiet">No characters yet. A goal, a fear, a voice and an arc give writers and reviewers something real to work from.</p>}</div>
    </section>
  </div>;
}

const mediumHint: Record<Brief["medium"], string> = {
  "Novel": "Prose: viewpoint discipline and interiority.",
  "Short story": "Prose: compressed arc, one turning point.",
  "Stage play": "Theatre: playable stage action and speaker cues.",
  "Screenplay": "Screen: INT./EXT. headings and visible action only.",
  "Audio drama": "Audio: SOUND: and MUSIC: cues carry the scene.",
  "Comic script": "Comics: numbered page and panel blocks.",
};

function ManuscriptTab() {
  const { project, updateProject, notify, flush } = useStudio();
  const [sceneId, setSceneId] = useDraftState("manuscript.scene", project.scenes[0]?.id || ""), [filter, setFilter] = useDraftState<Dimension | "All">("manuscript.filter", "All"), [side, setSide] = useDraftState<"findings" | "versions">("manuscript.side", "findings");
  const textRef = useRef<HTMLTextAreaElement>(null);
  const scene = project.scenes.find((s) => s.id === sceneId) || project.scenes[0];
  const chapters = useMemo(() => [...new Set(project.scenes.map((s) => s.chapter))], [project.scenes]);
  if (!scene) return <div className="page empty"><h3>No scenes</h3></div>;

  const setScene = (patch: Partial<Scene>) => updateProject(project.id, (p) => ({ scenes: p.scenes.map((s) => s.id === scene.id ? { ...s, ...patch, ...(patch.content !== undefined && s.state === "Accepted" ? { state: "Provisional" as const, acceptedHash: undefined } : {}) } : s) }));
  const setFinding = (id: string, patch: Partial<Finding>) => setScene({ findings: scene.findings.map((f) => f.id === id ? { ...f, ...patch } : f) });
  const open = scene.findings.filter((f) => f.status === "Open");
  const blocking = open.filter((f) => f.severity === "Blocking");
  const stale = scene.findings.filter((f) => f.status === "Open" && f.source === "Reviewer" && !/^\d+ words$/.test(f.quote) && !scene.content.includes(f.quote));
  const n = words(scene.content);
  const label = manuscriptLabel(project);

  const runChecks = () => {
    const kept = scene.findings.filter((f) => f.source === "Reviewer");
    const found = mechanicalReview(scene, project.brief);
    setScene({ findings: [...kept, ...found], state: scene.content.trim() ? "In review" : scene.state });
    notify(found.length ? `Quick checks found ${found.length} issue${found.length > 1 ? "s" : ""}` : "Quick checks passed. Model reviews still decide whether the scene is accepted.");
  };
  const accept = () => {
    setScene({ state: "Accepted", acceptedHash: hash(scene.content) });
    updateProject(project.id, (p) => ({ canon: p.canon.map((f) => f.sceneId === scene.id && f.state === "Provisional" ? { ...f, state: "Accepted" } : f) }));
    notify(`Scene accepted · locked to version #${hash(scene.content)}`);
  };
  const format = (mark: string) => {
    const el = textRef.current; if (!el) return;
    const a = el.selectionStart, b = el.selectionEnd;
    setScene({ content: el.value.slice(0, a) + mark + el.value.slice(a, b) + mark + el.value.slice(b) });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + mark.length, b + mark.length); });
  };
  const exportManuscript = () => {
    const banner = label === "Final" ? "" : `[${label.toUpperCase()} MANUSCRIPT: ${project.scenes.filter((s) => s.state !== "Accepted").length} scenes not yet accepted]\n\n`;
    const body = chapters.map((c) => `CHAPTER ${c}\n\n` + project.scenes.filter((s) => s.chapter === c).map((s) => `## ${s.title}${s.state === "Accepted" ? "" : ` (${s.state.toLowerCase()})`}\n\n${s.content || "[not yet written]"}`).join("\n\n")).join("\n\n---\n\n");
    download(`${slug(project.title)}-${label.toLowerCase()}.md`, banner + body, "text/markdown");
    notify(`${label} manuscript exported`);
  };
  const snapshot = () => { updateProject(project.id, (p) => ({ versions: [{ id: uid(), label: `Checkpoint ${p.versions.length + 1}`, created: now(), scenes: structuredClone(p.scenes) }, ...p.versions] })); notify("Checkpoint saved"); };

  return <div className="editor-layout">
    <aside className="doc-nav">
      <div className="nav-head"><b>Manuscript</b><Status>{label}</Status></div>
      {chapters.map((c) => <div key={c}><small className="chapter-label">Chapter {c}</small>
        {project.scenes.filter((s) => s.chapter === c).map((s) => <button className={s.id === scene.id ? "active" : ""} onClick={() => setSceneId(s.id)} key={s.id}><span className={`dot ${s.state.toLowerCase().replace(" ", "-")}`} />{s.title}{s.findings.some((f) => f.status === "Open" && f.severity === "Blocking") && <b className="flag">!</b>}</button>)}
      </div>)}
      <button className="add-section" onClick={() => { const s: Scene = { id: uid(), chapter: chapters.at(-1) || 1, title: "New scene", pov: "", location: "", content: "", state: "Draft", findings: [], minutes: 4, night: false }; updateProject(project.id, (p) => ({ scenes: [...p.scenes, s] })); setSceneId(s.id); }}><Icon name="plus" />Add scene</button>
      <div className="legend"><span><i className="dot draft" />Draft</span><span><i className="dot provisional" />Provisional</span><span><i className="dot in-review" />In review</span><span><i className="dot accepted" />Accepted</span></div>
    </aside>

    <article className="writing">
      <div className="formatbar">
        <button aria-label="Bold" onClick={() => format("**")}><b>B</b></button><button aria-label="Italic" onClick={() => format("_")}><i>I</i></button><span />
        <button className="pill" onClick={runChecks}><Icon name="check" size={15} />Run checks</button>
        <button className="pill" onClick={exportManuscript}><Icon name="download" size={15} />Export</button>
        <button className="pill" onClick={snapshot}><Icon name="canon" size={15} />Checkpoint</button>
      </div>
      <div className="paper">
        <select className="mobile-scenes" aria-label="Scene" value={scene.id} onChange={(e) => setSceneId(e.target.value)}>{project.scenes.map((s) => <option value={s.id} key={s.id}>Ch. {s.chapter} · {s.title} ({s.state.toLowerCase()})</option>)}</select>
        <div className="scene-meta"><Status>{scene.state}</Status>{scene.acceptedHash && <code title="Acceptance is locked to this exact version of the text">#{scene.acceptedHash}</code>}<span>Ch. {scene.chapter}</span>
          <input aria-label="Point of view" placeholder="POV" value={scene.pov} onChange={(e) => setScene({ pov: e.target.value })} />
          <input aria-label="Location" placeholder="Location" value={scene.location} onChange={(e) => setScene({ location: e.target.value })} /></div>
        <input aria-label="Scene title" value={scene.title} onChange={(e) => setScene({ title: e.target.value })} />
        <textarea ref={textRef} aria-label="Scene prose" value={scene.content} placeholder="Start writing, or run a pipeline to draft this scene." onChange={(e) => setScene({ content: e.target.value })} />
        <div className="wordcount"><span className={n && (n < project.brief.wordMin || n > project.brief.wordMax) ? "off" : ""}>{n} words · target {project.brief.wordMin}–{project.brief.wordMax} ({project.brief.lengthMode.toLowerCase()})</span>{scene.state === "Provisional" && <em>Edited after acceptance, so it needs another review</em>}</div>
      </div>
    </article>

    <aside className="comments">
      <div className="editor-tabs"><button className={side === "findings" ? "active" : ""} onClick={() => setSide("findings")}>Findings ({open.length})</button><button className={side === "versions" ? "active" : ""} onClick={() => setSide("versions")}>Checkpoints ({project.versions.length})</button></div>
      {side === "findings" ? <>
        <Segmented label="Dimension" value={filter} options={["All", "Story", "Rhetoric", "Memory"] as const} onChange={setFilter} />
        {scene.findings.filter((f) => filter === "All" || f.dimension === filter).map((f) => <div className={`finding ${f.status !== "Open" ? "closed" : ""} sev-${f.severity.toLowerCase()}`} key={f.id}>
          <div className="finding-head"><b>{f.dimension}</b><span>{f.severity}</span><small>{f.source}</small></div>
          <blockquote>“{f.quote}”</blockquote><p>{f.note}</p>
          {stale.includes(f) && <p className="stale">The quoted text isn't in the scene anymore, so this finding may be out of date.</p>}
          {f.status === "Open" ? <div className="comment-actions"><button onClick={() => setFinding(f.id, { status: "Repaired" })}>Mark repaired</button>{f.severity !== "Blocking" && <button onClick={() => setFinding(f.id, { status: "Waived" })}>Waive</button>}</div> : <div className="comment-actions"><span>{f.status}</span><button onClick={() => setFinding(f.id, { status: "Open" })}>Reopen</button></div>}
        </div>)}
        {!scene.findings.length && <p className="quiet">No findings yet. Run checks to test form, length and your must-avoid list.</p>}
        <AddFinding scene={scene} onAdd={(f) => setScene({ findings: [...scene.findings, f], state: "In review" })} />
        <div className="accept-box">
          <b>Ready to accept?</b>
          <small>{blocking.length ? `Fix ${blocking.length} blocking finding${blocking.length > 1 ? "s" : ""} first.` : scene.state === "Accepted" ? "Accepted. If you edit the text, it goes back to provisional." : "No blocking findings. Accepting locks canon to this exact version of the text."}</small>
          <button className="primary" disabled={!!blocking.length || !scene.content.trim() || scene.state === "Accepted"} onClick={accept}>Accept into canon</button>
        </div>
      </> : <div className="versions">
        {project.versions.map((v) => <div key={v.id}><b>{v.label}</b><small>{fmtTime(v.created)} · {v.scenes.filter((s) => s.state === "Accepted").length} accepted</small><button onClick={() => { updateProject(project.id, { scenes: structuredClone(v.scenes) }); notify("Checkpoint restored"); }}>Restore</button></div>)}
        {!project.versions.length && <p className="quiet">Save a checkpoint before big edits. Restoring one brings back the scenes only, and canon facts stay as they are.</p>}
      </div>}
    </aside>
  </div>;
}

function AddFinding({ scene, onAdd }: { scene: Scene; onAdd: (f: Finding) => void }) {
  const [openForm, setOpen] = useState(false), [err, setErr] = useState("");
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget), quote = String(d.get("quote")).trim();
    if (!scene.content.includes(quote)) { setErr("The quote needs to match text in this scene exactly."); return; }
    onAdd({ id: uid(), dimension: d.get("dimension") as Dimension, severity: d.get("severity") as Finding["severity"], quote, note: String(d.get("note")), status: "Open", source: "Reviewer" });
    setOpen(false); setErr("");
  };
  if (!openForm) return <button className="text-action add-finding" onClick={() => setOpen(true)}><Icon name="plus" size={15} />Add reviewer finding</button>;
  return <form className="finding-form" onSubmit={submit}>
    <div className="form-grid"><select name="dimension" aria-label="Dimension"><option>Story</option><option>Rhetoric</option><option>Memory</option></select><select name="severity" aria-label="Severity"><option>Minor</option><option>Major</option><option>Blocking</option></select></div>
    <input name="quote" aria-label="Evidence quote" required placeholder="Exact quote from the scene" /><textarea name="note" aria-label="Finding and explanation" required placeholder="What's wrong, and why it matters" />
    {err && <p className="stale">{err}</p>}
    <div className="comment-actions"><button>Add</button><button type="button" onClick={() => setOpen(false)}>Cancel</button></div>
  </form>;
}

function CanonTab() {
  const { project, updateProject } = useStudio();
  const [kind, setKind] = useState<FactKind | "All">("All"), [holder, setHolder] = useState("All");
  const holders = [...new Set(project.canon.flatMap((f) => f.holders))];
  const facts = project.canon.filter((f) => (kind === "All" || f.kind === kind) && (holder === "All" || f.holders.includes(holder)));
  const threads = project.canon.filter((f) => f.kind === "Thread");
  const sceneTitle = (id: string) => project.scenes.find((s) => s.id === id)?.title || "Unknown scene";
  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const f: Fact = { id: uid(), kind: d.get("kind") as FactKind, text: String(d.get("text")), holders: String(d.get("holders")).split(",").map((x) => x.trim()).filter(Boolean), sceneId: String(d.get("scene")), state: "Provisional" };
    if (!f.holders.length) f.holders = ["Public"];
    updateProject(project.id, (p) => ({ canon: [...p.canon, f] }));
    e.currentTarget.reset();
  };
  const setFact = (id: string, patch: Partial<Fact>) => updateProject(project.id, (p) => ({ canon: p.canon.map((f) => f.id === id ? { ...f, ...patch } : f) }));
  return <div className="page">
    <div className="canon-stats">{(["Accepted", "Provisional", "Quarantined"] as const).map((s) => <div className="panel" key={s}><b>{project.canon.filter((f) => f.state === s).length}</b><span>{s} facts</span></div>)}<div className="panel"><b>{holders.filter((h) => h !== "Public" && h !== "Reader").length}</b><span>private knowledge holders</span></div></div>
    <div className="canon-layout">
      <section>
        <div className="toolbar"><select aria-label="Fact kind" value={kind} onChange={(e) => setKind(e.target.value as FactKind | "All")}><option>All</option>{FACT_KINDS.map((k) => <option key={k}>{k}</option>)}</select><select aria-label="Knowledge holder" value={holder} onChange={(e) => setHolder(e.target.value)}><option>All</option>{holders.map((h) => <option key={h}>{h}</option>)}</select></div>
        <div className="ledger">{facts.map((f) => <div className={`fact ${f.state.toLowerCase()}`} key={f.id}>
          <span className="kind">{f.kind}</span>
          <div><p>{f.text}</p><small>Source: {sceneTitle(f.sceneId)} · Known to {f.holders.join(", ")}{f.thread ? ` · Thread ${f.thread.toLowerCase()}` : ""}</small></div>
          <Status>{f.state}</Status>
          {f.state !== "Quarantined" ? <button className="link" onClick={() => setFact(f.id, { state: "Quarantined" })}>Quarantine</button> : <button className="link" onClick={() => setFact(f.id, { state: "Provisional" })}>Restore</button>}
        </div>)}{!facts.length && <p className="quiet">No facts match.</p>}</div>
        <p className="hint">These author notes are saved with your project. Quarantine facts to keep their history. Original runner canon and review evidence stay available in Project files.</p>
      </section>
      <aside>
        <section className="panel"><h2>Add to ledger</h2>
          <form className="fact-form" onSubmit={add}>
            <select name="kind" aria-label="Kind">{FACT_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
            <textarea name="text" aria-label="Canon fact" required placeholder="What is now true, believed or claimed?" />
            <input name="holders" aria-label="Knowledge holders" placeholder="Known to (comma separated, leave blank for Public)" />
            <select name="scene" aria-label="Source scene">{project.scenes.map((s) => <option value={s.id} key={s.id}>{s.title}</option>)}</select>
            <button className="primary">Add provisional fact</button>
          </form>
        </section>
        <section className="panel"><h2>Threads</h2>
          {threads.map((t) => <div className="thread" key={t.id}><p>{t.text}</p><Segmented label="Thread stage" value={t.thread || "Setup"} options={["Setup", "Escalation", "Payoff"] as const} onChange={(thread) => setFact(t.id, { thread })} /></div>)}
          {!threads.length && <p className="quiet">Add a Thread fact to track setup, escalation and payoff.</p>}
        </section>
      </aside>
    </div>
  </div>;
}

function PipelineTab() {
  const { project, startRun, go, jobs } = useStudio();
  return <div className="page"><div className="mode-grid">{MODES.map(m=><article className="panel mode-card" key={m.id}><code className="mode-file">{m.workflow}</code><h2>{m.name}</h2><p>{m.summary}</p><ol>{m.stages.map(s=><li key={s}>{s}</li>)}</ol><button className="primary" onClick={()=>startRun(project.id,m.id)}>Configure workflow</button></article>)}</div><section className="panel"><h2>Current studio jobs</h2>{jobs.map(j=><p key={j.id}>{j.kind} · {j.status} · {j.message}</p>)}{!jobs.length&&<p>No studio jobs for this story yet.</p>}<button className="secondary" onClick={()=>go('runs')}>Open GitHub history and all workflows</button></section></div>;
}
