import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { label } from "../atlas";
import "../atlas.css";
import { uid } from "../data";
import { useStudio } from "../store";
import type { AtlasSource, CreativeMode } from "../types";
import { ago, Icon, PageTitle, Segmented } from "../ui";
import { Artwork } from "../art";

const MODES: CreativeMode[] = ["Ideas", "Draft", "Review", "Revise"];
const HELP: Record<CreativeMode, string> = {
  Ideas: "Start with whatever you have. We’ll develop your idea and fill in the missing details.",
  Draft: "Turn your brief into a passage, scene or script.",
  Review: "Get specific feedback on your writing. Your manuscript stays unchanged.",
  Revise: "Improve a passage using your feedback.",
};
type Output = { title?: string; text?: string; summary?: string; pass?: boolean; completed_brief?: Record<string, unknown>; assumptions?: unknown[]; suggestions?: unknown[]; issues?: unknown[] };
type CreativeRecord = { id: string; created_at: string; status: string; model: string; request: { operation: string; loop_mode?: string; guidance_mode?: string }; result?: Output; steps: { stage: string; output: Output; usage?: Record<string, unknown> }[] };
type Job = { id: string; kind: string; status: string; message?: string; project_id?: string };
const pending = (j: Job) => ["queued", "running"].includes(j.status);
const readable = (v: unknown): string => typeof v === "string" ? v : JSON.stringify(v, null, 2);
const FIELD_NAMES: Record<string, string> = { pov: "Point of view", worldRules: "World rules", mustAvoid: "Things to avoid", ending_direction: "Ending direction", scenesPerChapter: "Scenes per chapter", wordMin: "Minimum scene length", wordMax: "Maximum scene length" };
const fieldName = (key: string) => FIELD_NAMES[key] || key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
function describe(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.map((item) => `• ${describe(item)}`).join("\n");
  if (typeof value === "object") return Object.entries(value).map(([key, item]) => `${fieldName(key)}: ${describe(item)}`).join("\n");
  return String(value);
}
function displayOutput(value: Output | undefined): Output | undefined {
  if (!value || typeof value !== "object") return undefined;
  return { ...value, title: typeof value.title === "string" ? value.title : undefined, text: typeof value.text === "string" ? value.text : undefined,
    summary: typeof value.summary === "string" ? value.summary : undefined, assumptions: Array.isArray(value.assumptions) ? value.assumptions : [],
    suggestions: Array.isArray(value.suggestions) ? value.suggestions : [], issues: Array.isArray(value.issues) ? value.issues : [],
    completed_brief: value.completed_brief && typeof value.completed_brief === "object" && !Array.isArray(value.completed_brief) ? value.completed_brief : undefined };
}
const message = (e: unknown) => e instanceof Error ? e.message : "The request could not be completed.";
const projectPath = (path: string, id: string) => `${path}?project_id=${encodeURIComponent(id)}`;

// Carry the policy in the brief too, for servers running the earlier creative API.
function ideaPolicy(guidance: string, structure: string) {
  return `DEVELOPMENT PREFERENCES: Preserve every explicit author choice. Fill all unspecified gaps with sensible, coherent decisions, including character motivation, conflict, stakes, setting, tone, point of view, structure and ending direction. Do not ask me to complete missing fields. Disclose inferred decisions as assumptions, not established canon. ${guidance === "use_idea" ? "Use my idea as given. Do not replace its premise or provide unsolicited alternatives or improvement feedback. Return an empty suggestions array." : "Keep my original idea as the main recommendation. Offer up to three optional improvements with reasons, separately from the developed idea; do not silently apply them."} ${structure.trim() ? `Honor this structure: ${structure.trim()}` : "Choose a structure that suits the story."} Return title, text, completed_brief (premise, medium, genre, tone, pov, themes, worldRules, mustAvoid, characters with arcs, structure, stakes, ending_direction, chapters, scenesPerChapter, wordMin, wordMax), assumptions as strings, and suggestions as objects with suggestion and reason. Choose sensible positive integer length settings when unspecified and list those decisions as assumptions.`;
}

export default function Creative() {
  const { project, selectProject, notify, seed, clearSeed, go, refresh, ready, flush } = useStudio();
  const [mode, setMode] = useState<CreativeMode>("Ideas"), [input, setInput] = useState(""), [feedback, setFeedback] = useState(""), [target, setTarget] = useState(600), [rounds, setRounds] = useState(1), [context, setContext] = useState(true);
  const [guidance, setGuidance] = useState("Suggest improvements"), [structure, setStructure] = useState(""), [refine, setRefine] = useState(false);
  const [source, setSource] = useState<AtlasSource | undefined>();
  const [records, setRecords] = useState<CreativeRecord[]>([]), [jobs, setJobs] = useState<Job[]>([]), [error, setError] = useState(""), [loading, setLoading] = useState(true), [submitting, setSubmitting] = useState(false), [adopting, setAdopting] = useState("");
  const [revision, setRevision] = useState(0);
  const currentProject = useRef(project.id), mounted = useRef(false);
  currentProject.current = project.id;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (seed) { setMode(seed.mode); setInput(seed.input); setSource(seed.source); setContext(false); clearSeed(); } }, [seed]);
  useEffect(() => {
    const changed = () => setRevision((n) => n + 1);
    window.addEventListener("studio-refresh", changed);
    return () => window.removeEventListener("studio-refresh", changed);
  }, []);
  useEffect(() => { setRecords([]); setJobs([]); setSubmitting(false); setAdopting(""); }, [project.id]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const id = project.id;
    if (!id || !ready) { setLoading(false); return; }
    setLoading(true); setError("");
    const saved = async () => {
      const response = await api<{ results: CreativeRecord[] }>(projectPath("/api/studio/creative", id));
      if (active) setRecords(response.results);
    };
    const poll = async (previous: Job[]) => {
      try {
        const next = await Promise.all(previous.map((j) => pending(j) ? api<Job>(`/api/job/${j.id}`) : Promise.resolve(j)));
        if (!active) return;
        setJobs(next);
        if (next.some((j, index) => j.status !== previous[index].status && !pending(j))) await saved();
        if (active && next.some(pending)) timer = setTimeout(() => { void poll(next); }, 2500);
      } catch (e) { if (active) setError(message(e)); }
    };
    void (async () => {
      try {
        const response = await api<{ jobs: Job[] }>(projectPath("/api/studio/jobs", id));
        // Read outputs after statuses so a just-completed job cannot be missed.
        await saved();
        if (!active) return;
        const creative = response.jobs.filter((j) => j.kind === "creative");
        setJobs(creative);
        if (creative.some(pending)) timer = setTimeout(() => { void poll(creative); }, 1500);
      } catch (e) { if (active) setError(message(e)); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [project.id, ready, revision]);

  const needsText = mode === "Review" || mode === "Revise";
  const working = submitting || jobs.some(pending);
  const run = async () => {
    const id = project.id;
    if (!id || submitting || working) return;
    setSubmitting(true); setError("");
    const guidanceMode = guidance === "Use my idea" ? "use_idea" : "suggest";
    const sourceContext = source ? `Atlas reference: ${source.title} (${source.tradition}). Approach: ${source.approach}. Story mechanism: ${source.instruction}\n${source.analysis}` : "";
    const brief = [needsText ? "" : input, sourceContext, mode === "Ideas" ? ideaPolicy(guidanceMode, structure) : ""].filter(Boolean).join("\n\n");
    try {
      await flush();
      const response = await api<{ job_id: string }>(projectPath("/api/studio/creative", id), {
        operation: refine && (mode === "Ideas" || mode === "Draft") ? "loop" : mode.toLowerCase(), loop_mode: mode === "Ideas" ? "ideas" : "prose",
        brief, text: needsText ? input : "", feedback, words: target, rounds, use_story: context,
        guidance_mode: guidanceMode, structure,
      });
      if (mounted.current && currentProject.current === id) setJobs((previous) => [{ id: response.job_id, kind: "creative", status: "queued", project_id: id }, ...previous]);
      window.dispatchEvent(new Event("studio-refresh"));
      if (mounted.current && currentProject.current === id) notify("Started. Your result will be saved here while you explore the studio.");
    } catch (e) { if (mounted.current && currentProject.current === id) setError(message(e)); }
    finally { if (mounted.current && currentProject.current === id) setSubmitting(false); }
  };
  const adopt = async (r: CreativeRecord) => {
    const id = project.id;
    setAdopting(r.id); setError("");
    try {
      const result = await api<{ id: string }>(projectPath(`/api/ui/creative/${r.id}/use-as-project`, id), {});
      await refresh();
      if (mounted.current && currentProject.current === id) { selectProject(result.id, "brief"); notify("Your idea is now a project. You can edit every detail in its brief."); }
    } catch (e) { if (mounted.current && currentProject.current === id) setError(message(e)); }
    finally { if (mounted.current && currentProject.current === id) setAdopting(""); }
  };

  return <div className="page">
    <PageTitle eyebrow="FROM A SPARK TO A STORY" title="Develop your idea" text="Tell us as much or as little as you like. Keep your choices, let the AI fill the gaps, and edit the result whenever you want." />
    {!project.id && ready && <div className="panel"><p>Create a project to keep your ideas and results together.</p><button className="primary" onClick={() => go("projects")}>Go to projects</button></div>}
    {error && <div className="panel" role="alert"><p>{error}</p><button onClick={() => setRevision((n) => n + 1)}>Try loading again</button> <button onClick={() => go("connections")}>Check connections</button></div>}
    <div className="creative-layout">
      <section className="panel">
        {source ? <div className="atlas-seed"><Icon name="atlas" size={18} /><div>
          <span className="eyebrow">FROM THE STORY ATLAS · {source.approach.toUpperCase()}</span><b>{source.title}</b>
          <p>{source.tradition} · {source.place}<br />Story mechanism: {label(source.mechanism)}: {source.instruction}</p>
          <div className="comment-actions"><button onClick={() => go("atlas")}>Back to atlas</button><button onClick={() => setSource(undefined)}>Remove source</button></div>
        </div></div> : <button className="text-action atlas-start" onClick={() => go("atlas")}><Icon name="atlas" size={15} />Find inspiration in the story atlas</button>}
        <Segmented label="Creative mode" value={mode} options={MODES} onChange={setMode} />
        <p className="hint">{HELP[mode]}</p>
        <label className="field">{needsText ? "Your writing" : "Your idea"}<textarea className="tall" value={input} maxLength={needsText ? 20000 : 12000} onChange={(e) => setInput(e.target.value)} placeholder={needsText ? "Paste the passage" : "A lighthouse keeper starts receiving letters from the future…"} /></label>
        {mode === "Ideas" && <>
          <Segmented label="How should we develop your idea?" value={guidance} options={["Suggest improvements", "Use my idea"]} onChange={setGuidance} />
          <p className="hint">{guidance === "Use my idea" ? "Your choices stay as they are. We’ll only decide details you haven’t specified." : "We’ll develop your idea and offer optional suggestions. You decide whether to use them."}</p>
          <label className="field">Story structure <span className="hint">Optional</span><textarea value={structure} maxLength={2000} onChange={(e) => setStructure(e.target.value)} placeholder="For example: two timelines, a mystery told backwards, or three acts. Leave blank and we’ll choose." /></label>
          <p className="hint">No need to name every character, setting or plot point. We’ll explain the choices we make.</p>
        </>}
        {mode === "Revise" && <label className="field">What should change?<textarea value={feedback} maxLength={4000} onChange={(e) => setFeedback(e.target.value)} placeholder="Optional: tell us what to improve, or let the AI decide." /></label>}
        <details><summary>Writing preferences</summary><div className="form-grid">
          <label className="field">Target length · {target} words<input type="range" min={100} max={3000} step={50} value={target} onChange={(e) => setTarget(Number(e.target.value))} /></label>
          {(mode === "Ideas" || mode === "Draft") && <><label className="toggle"><input type="checkbox" checked={refine} onChange={(e) => setRefine(e.target.checked)} />Review and refine the result automatically</label>{refine && <label className="field">Maximum revision rounds<select value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n} · stops early when ready</option>)}</select></label>}</>}
        </div><p className="hint">Each extra review and revision uses the connected AI provider.</p></details>
        <label className="toggle"><input type="checkbox" checked={context} onChange={(e) => setContext(e.target.checked)} />Use writing from <b>{project.title || "this project"}</b></label>
        <button className="primary" disabled={!ready || !project.id || working || (needsText && !input.trim())} onClick={() => { void run(); }}><Icon name="sparkle" size={15} />{working ? "Working on your idea…" : mode === "Ideas" ? "Develop my idea" : `${mode} my writing`}</button>
        <p className="hint">Generated by your connected AI provider. Results are saved to this project.</p>
      </section>
      <section className="results" aria-label="Creative results">
        {working && <div className="panel" role="status"><span className="eyebrow">YOUR STORY IS TAKING SHAPE</span><h3>You can keep creating while we work.</h3><p>{jobs.find(pending)?.message || "Preparing your request…"} Your result will be waiting here when you return.</p><div className="comment-actions"><button onClick={() => go("images")}>Create a visual</button><button onClick={() => go("music")}>Find its sound</button><button onClick={() => go("production")}>Plan production</button></div></div>}
        {jobs.filter((j) => ["failed", "interrupted"].includes(j.status)).slice(0, 1).map((j) => <div className="panel" role="status" key={j.id}><b>Earlier request {j.status}</b><p>{j.message || "The request did not finish. You can try again when the connection is ready."}</p></div>)}
        {loading && !records.length && <p role="status">Loading saved results…</p>}
        {records.map((r) => {
          const output = displayOutput(r.result);
          return <article className="panel result" key={r.id}>
            <div className="finding-head"><b>{output?.title || r.request.operation}</b><small>{ago(r.created_at)} · {r.status} · {r.steps.length} AI call{r.steps.length === 1 ? "" : "s"}</small></div>
            {output?.text && <pre>{output.text}</pre>}
            {output?.summary && <p>{output.summary}</p>}
            {!!output?.issues?.length && <div><h3>Feedback</h3>{output.issues.map((issue, i) => <pre key={i}>{describe(issue)}</pre>)}</div>}
            {!!output?.assumptions?.length && <div><h3>Details we filled in</h3><p className="hint">These are editable choices, not facts you supplied.</p><ul>{output.assumptions.map((a, i) => <li key={i}>{describe(a)}</li>)}</ul></div>}
            {!!output?.suggestions?.length && <div><h3>Optional improvements</h3><p className="hint">Keep your idea as it is, or copy a suggestion into your next revision.</p>{output.suggestions.map((s, i) => {
              return <pre key={i}>{describe(s)}</pre>;
            })}</div>}
            {output?.completed_brief && <details><summary>Your developed brief</summary><dl>{Object.entries(output.completed_brief).map(([key, value]) => <div key={key}><dt>{fieldName(key)}</dt><dd><pre>{describe(value)}</pre></dd></div>)}</dl></details>}
            {output && <div className="comment-actions"><button onClick={() => { setMode("Revise"); setInput(output.text || output.summary || ""); }}>Revise this</button><button onClick={async () => { try { await navigator.clipboard.writeText(output.text || describe(output)); notify("Copied"); } catch { notify("Could not copy. Select the text to copy it manually."); } }}>Copy</button>{output.text && r.status === "complete" && <button disabled={!!adopting} onClick={() => { void adopt(r); }}>{adopting === r.id ? "Creating project…" : "Use as project"}</button>}</div>}
            <details><summary>Generation details</summary><p className="hint">{r.model}</p>{r.steps.map((step, index) => <details key={index}><summary>{index + 1}. {step.stage}</summary><pre>{readable(step.output)}</pre></details>)}</details>
          </article>;
        })}
        {!loading && !records.length && !working && <div className="empty illustrated-empty"><Artwork name="enchanted" /><div className="empty-copy"><span className="eyebrow">ROOM FOR POSSIBILITY</span><h3>Every idea opens a door.</h3><p>Start with one sentence. Your saved results and the decisions behind them will appear here.</p></div></div>}
      </section>
    </div>
    <IdeaBoard />
  </div>;
}

function IdeaBoard() {
  const { store, setStore, notify } = useStudio();
  const ideas = store.ideas;
  const set = (next: typeof ideas) => setStore((s) => ({ ...s, ideas: next }));
  const add = () => { set([...ideas, { id: uid(), label: "NEW IDEA", title: "Untitled idea", body: "", color: "paper-note" }]); notify("Idea added"); };
  return <section className="section"><div className="section-head"><div><span className="eyebrow">CREATIVE SPACE</span><h2>Idea board</h2></div><button className="text-action" onClick={add}><Icon name="plus" size={15} />Add note</button></div>
    <div className="idea-board">{ideas.map((n) => <div className={`idea-note ${n.color}`} key={n.id}>
      <input value={n.label} aria-label="Note label" onChange={(e) => set(ideas.map((x) => x.id === n.id ? { ...x, label: e.target.value } : x))} />
      <textarea className="idea-title" value={n.title} aria-label="Note title" onChange={(e) => set(ideas.map((x) => x.id === n.id ? { ...x, title: e.target.value } : x))} />
      <textarea value={n.body} aria-label="Note text" onChange={(e) => set(ideas.map((x) => x.id === n.id ? { ...x, body: e.target.value } : x))} />
      <button className="delete-note" onClick={() => set(ideas.filter((x) => x.id !== n.id))}>Remove</button>
    </div>)}<button className="idea-add" onClick={add}><Icon name="plus" />Add note</button></div>
  </section>;
}
