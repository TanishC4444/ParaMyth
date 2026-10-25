import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, studioJobs, type Job } from "../api";
import { label } from "../atlas";
import "../atlas.css";
import { uid } from "../data";
import { useStudio, useDraftState } from "../store";
import type { AtlasSource, CreativeMode } from "../types";
import { ago, Icon, PageTitle, Segmented } from "../ui";
import IdeaEditor, { type InlineSuggestion } from "../IdeaEditor";
import { BrandSpot } from "../brandArt";
import { useMaterials } from "../materials";

const MODES: CreativeMode[] = ["Ideas", "Draft", "Review", "Revise"];
const HELP: Record<CreativeMode, string> = {
  Ideas: "Start with whatever you have. We’ll develop your idea and fill in the missing details.",
  Draft: "Turn your brief into a passage, scene or script.",
  Review: "Get specific feedback on your writing. Your manuscript stays unchanged.",
  Revise: "Improve a passage using your feedback.",
};
type Output = { title?: string; text?: string; summary?: string; pass?: boolean; completed_brief?: Record<string, unknown>; assumptions?: unknown[]; suggestions?: unknown[]; issues?: unknown[] };
type CreativeRecord = { id: string; created_at: string; status: string; model: string; request: { context_chapter?: number; operation: string; loop_mode?: string; guidance_mode?: string }; result?: Output; preview?: Job["preview"]; steps: { stage: string; output: Output; usage?: Record<string, unknown> }[] };
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
  return `DEVELOPMENT PREFERENCES: Preserve every explicit author choice. Fill all unspecified gaps with sensible, coherent decisions, including character motivation, conflict, stakes, setting, tone, point of view, structure and ending direction. Do not ask me to complete missing fields. Suggestions should identify missing aspects such as character descriptions, motivation, setting, stakes or structure, each with aspect, suggestion, reason, quote and a concrete replacement proposal. Disclose inferred decisions as assumptions, not established canon. ${guidance === "use_idea" ? "Use my idea as given. Do not replace its premise or provide unsolicited alternatives or improvement feedback. Return an empty suggestions array." : "Keep my original idea as the main recommendation. Offer up to three optional improvements with reasons, separately from the developed idea; do not silently apply them."} ${structure.trim() ? `Honor this structure: ${structure.trim()}` : "Choose a structure that suits the story."} Return title, text, completed_brief (premise, medium, genre, tone, pov, themes, worldRules, mustAvoid, characters with arcs, structure, stakes, ending_direction, chapters, scenesPerChapter, wordMin, wordMax), assumptions as strings, and suggestions as objects with suggestion and reason. Choose sensible positive integer length settings when unspecified and list those decisions as assumptions.`;
}

export default function Creative({ ideasOnly = false, chapter = 1, sceneId = "", onStart, writingBusy = false }: { ideasOnly?:boolean; chapter?:number; sceneId?:string; onStart?:()=>void; writingBusy?:boolean }) {
  const key=(name:string)=>ideasOnly && chapter>1 ? name.replace("creative.",`creative.chapter${chapter}.`) : name;
  const { project, selectProject, notify, seed, clearSeed, go, refresh, ready, flush } = useStudio();
  const { source: writingSource, sourceTitle } = useMaterials();
  const [savedMode, setMode] = useDraftState<CreativeMode>(key("creative.mode"), "Ideas"), [input, setInput] = useDraftState(key("creative.input"), ""), [feedback, setFeedback] = useDraftState(key("creative.feedback"), ""), [target, setTarget] = useDraftState(key("creative.target"), 600), [rounds, setRounds] = useDraftState(key("creative.rounds"), 1), [context, setContext] = useDraftState(key("creative.context"), true);
  const mode = ideasOnly ? "Ideas" : savedMode;
  const [guidance, setGuidance] = useDraftState(key("creative.guidance"), "Suggest improvements"), [structure, setStructure] = useDraftState(key("creative.structure"), ""), [refine, setRefine] = useDraftState(key("creative.refine"), false);
  const [source, setSource] = useDraftState<AtlasSource | undefined>(key("creative.source"), undefined);
  const [records, setRecords] = useState<CreativeRecord[]>([]), [jobs, setJobs] = useState<Job[]>([]), [error, setError] = useState(""), [loading, setLoading] = useState(true), [submitting, setSubmitting] = useState(false), [adopting, setAdopting] = useState("");
  const [revision, setRevision] = useState(0);
  const [selectedResult, setSelectedResult] = useDraftState(key("creative.selectedResult"), "");
  const [inlineSuggestions, setInlineSuggestions] = useDraftState<InlineSuggestion[]>(key("creative.inlineSuggestions"), []);
  const [ideaBase, setIdeaBase] = useDraftState(key("creative.ideaBase"), "");
  const [waitingIdea, setWaitingIdea] = useDraftState(key("creative.waitingIdea"), false);
  const [ideaJob, setIdeaJob] = useDraftState(key("creative.ideaJob"), "");
  const [ideaResult, setIdeaResult] = useDraftState<CreativeRecord | null>(key("creative.ideaResult"), null);
  const [ideaToReview, setIdeaToReview] = useDraftState(key("creative.ideaToReview"), false);
  const revisionInput = useRef<HTMLTextAreaElement>(null);
  const currentProject = useRef(project.id), mounted = useRef(false);
  currentProject.current = project.id;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (seed) { setMode(seed.mode); setInput(seed.input); setSource(seed.source); setContext(false); clearSeed(); } }, [seed]);
  useEffect(() => {
    const changed = () => setRevision((n) => n + 1);
    window.addEventListener("studio-refresh", changed);
    return () => window.removeEventListener("studio-refresh", changed);
  }, []);
  useEffect(() => { setRecords([]); setJobs([]); setSubmitting(false); setAdopting(""); }, [project.id,chapter]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const id = project.id;
    if (!id || !ready) { setLoading(false); return; }
    setLoading(true); setError("");
    const saved = async () => {
      const response = await api<{ results: CreativeRecord[] }>(projectPath("/api/ui/creative", id));
      if (active) setRecords(response.results);
    };
    const poll = async (previous: Job[]) => {
      try {
        const next = await Promise.all(previous.map((j) => pending(j) && !j.streaming ? api<Job>(`/api/job/${j.id}`) : Promise.resolve(j)));
        if (!active) return;
        setJobs((current) => next.map((j) => j.streaming ? current.find((c) => c.id === j.id) || j : j));
        if (next.some((j, index) => j.status !== previous[index].status)) await saved();
        if (active && next.some((j) => pending(j) && !j.streaming)) timer = setTimeout(() => { void poll(next); }, 2500);
      } catch (e) { if (active) setError(message(e)); }
    };
    void (async () => {
      try {
        const allJobs = await studioJobs(id);
        // Read outputs after statuses so a just-completed job cannot be missed.
        await saved();
        if (!active) return;
        const creative = allJobs.filter((j) => j.kind === "creative" && (!ideasOnly || (!(j.preview?.chapter || j.result?.request?.chapter) && (j.id === ideaJob || (j.preview?.context_chapter || j.result?.request?.context_chapter || 1) === chapter))));
        setJobs(creative);
        if (creative.some((j) => pending(j) && !j.streaming)) timer = setTimeout(() => { void poll(creative); }, 1500);
      } catch (e) { if (active) setError(message(e)); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [project.id, ready, revision, ideasOnly, chapter, ideaJob]);

  const streamingIds = jobs.filter((j) => j.streaming && pending(j)).map((j) => j.id).sort().join(",");
  useEffect(() => {
    if (!streamingIds) return;
    let active = true;
    const connections = streamingIds.split(",").map((id) => {
      const events = new EventSource(projectPath(`/api/ui/creative/jobs/${id}/events`, project.id));
      events.addEventListener("progress", (event) => {
        if (!active) return;
        const next = JSON.parse((event as MessageEvent).data) as Job;
        setJobs((previous) => previous.map((j) => j.id === id ? next : j));
        window.dispatchEvent(new CustomEvent("studio-writing-progress",{detail:{projectId:project.id}}));
        if (!pending(next)) {
          events.close();
          if (next.result) setRecords((previous) => [next.result, ...previous.filter((r) => r.id !== next.result.id)]);
          else void api<{ results: CreativeRecord[] }>(projectPath("/api/ui/creative", project.id)).then((r) => { if (active) setRecords(r.results); }).catch(() => {});
          window.dispatchEvent(new Event("studio-refresh"));
        }
      });
      // EventSource reconnects to the same job and receives its latest saved text.
      // Reconnecting never submits another generation request.
      return events;
    });
    return () => { active = false; connections.forEach((events) => events.close()); };
  }, [streamingIds, project.id]);
  useEffect(() => {
    if (!waitingIdea || !ideaJob) return;
    const job = jobs.find((j) => j.id === ideaJob);
    if (!job || pending(job)) return;
    if (job.status !== "complete") { setWaitingIdea(false); return; }
    const result = job.result as CreativeRecord | undefined;
    if (!result || result.id === ideaResult?.id) return;
    setIdeaResult(result); setWaitingIdea(false);
    if (input === ideaBase) {
      setInput(result.result?.text || input);
      setInlineSuggestions((result.result?.suggestions || []).filter((v): v is InlineSuggestion => !!v && typeof v === "object"));
      setIdeaToReview(false);
    } else setIdeaToReview(true);
  }, [records, jobs, waitingIdea, ideaJob]);
  const liveJob = jobs.find((j) => j.streaming && pending(j));
  const latestFailure = jobs[0] && ["failed", "interrupted"].includes(jobs[0].status) ? jobs[0] : undefined;

  const needsText = mode === "Review" || mode === "Revise";
  const working = submitting || jobs.some(pending);
  const run = async () => {
    const id = project.id;
    if (!id || submitting || working) return;
    setSubmitting(true); setError("");
    if (mode === "Ideas") { setIdeaJob(""); setIdeaBase(input); setWaitingIdea(true); setInlineSuggestions([]); }
    const guidanceMode = guidance === "Use my idea" ? "use_idea" : "suggest";
    const sourceContext = source ? `Atlas reference: ${source.title} (${source.tradition}). Approach: ${source.approach}. Story mechanism: ${source.instruction}\n${source.analysis}` : "";
    const brief = [needsText ? "" : input, sourceContext, mode === "Ideas" ? ideaPolicy(guidanceMode, structure) : ""].filter(Boolean).join("\n\n");
    try {
      await flush();
      const response = await api<{ job_id: string }>(projectPath("/api/ui/creative", id), {
        operation: refine && (mode === "Ideas" || mode === "Draft") ? "loop" : mode.toLowerCase(), loop_mode: mode === "Ideas" ? "ideas" : "prose",
        brief, text: needsText ? input : "", feedback, words: target, rounds, use_story: context,
        guidance_mode: guidanceMode, structure, story_source: writingSource, context_chapter: ideasOnly ? chapter : 0, scene_id: sceneId,
      });
      if (mode === "Ideas") setIdeaJob(response.job_id);
      if (mounted.current && currentProject.current === id) setJobs((previous) => [{ id: response.job_id, kind: "creative", status: "queued", project_id: id, streaming: true, created_at: new Date().toISOString(), message: "Preparing your request…" }, ...previous]);
      window.dispatchEvent(new Event("studio-refresh"));
      if (mounted.current && currentProject.current === id) notify("Started. Your result will be saved here while you explore the studio.");
    } catch (e) { if (mounted.current && currentProject.current === id) setError(message(e)); }
    finally { if (mounted.current && currentProject.current === id) setSubmitting(false); }
  };
  const adopt = async (r: CreativeRecord) => {
    const id = project.id;
    setAdopting(r.id); setError("");
    try {
      const result = await api<{ id: string }>(projectPath(`/api/ui/creative/${r.id}/use-as-project`, id), { text: r.result?.text });
      await refresh();
      if (mounted.current && currentProject.current === id) { selectProject(result.id, "brief"); notify("Your idea is now a project. You can edit every detail in its brief."); }
    } catch (e) { if (mounted.current && currentProject.current === id) setError(message(e)); }
    finally { if (mounted.current && currentProject.current === id) setAdopting(""); }
  };

  const shown = records.find((r) => r.id === selectedResult) || records[0];
  return <div className="page simple-workspace">
    <PageTitle title={ideasOnly ? "Shape your idea" : "Creative workspace"} text="Start with an idea. We’ll fill in the gaps, and you can edit every choice." />
    {!project.id && ready && <div className="panel"><p>Create a project to keep your ideas and results together.</p><button className="primary" onClick={() => go("projects")}>Go to projects</button></div>}
    {error && <div className="panel" role="alert"><p>{error}</p><button onClick={() => setRevision((n) => n + 1)}>Try loading again</button> <button onClick={() => go("connections")}>Check connections</button></div>}
    {latestFailure && !submitting && <div className="panel" role="alert"><p>Latest writing request {latestFailure.status} · {ago(latestFailure.created_at)}</p><p>{latestFailure.message || "The request did not finish. Try again when the connection is ready."}</p>{latestFailure.preview?.text && <details><summary>Saved partial writing</summary><pre>{latestFailure.preview.text}</pre></details>}</div>}
    <div className={`creative-layout${mode === "Ideas" ? " ideas-layout" : ""}`}>
      <section className="panel composer">
        {!ideasOnly && <Segmented label="Creative mode" value={mode} options={MODES} onChange={setMode} />}
        {mode !== "Ideas" && <p className="hint">{HELP[mode]}</p>}
        {mode === "Ideas" ? <IdeaEditor onStart={onStart} startDisabled={!ready || !project.id || working || writingBusy} value={input} onChange={setInput} suggestions={inlineSuggestions} onSuggestions={setInlineSuggestions} pending={ideaToReview ? () => { setInput(ideaResult?.result?.text || input); setInlineSuggestions((ideaResult?.result?.suggestions || []).filter((v): v is InlineSuggestion => !!v && typeof v === "object")); setIdeaToReview(false); } : undefined} /> : <label className="field">{needsText ? "Your writing" : "Your idea"}<textarea className="tall" value={input} maxLength={20000} onChange={(e) => setInput(e.target.value)} placeholder={needsText ? "Paste the passage" : "Describe the writing you want"} /></label>}
        {mode === "Ideas" && working && <p className="hint" role="status">{liveJob?.message || "Developing your idea…"} You can create visuals or sound alongside it.</p>}
        {mode === "Ideas" && ideaResult && <div className="comment-actions">{!ideasOnly && <button onClick={() => { setMode("Draft"); }}>Write from this idea</button>}<button onClick={() => void adopt({...ideaResult, result: {...ideaResult.result, text: input}})}>Use as new project</button></div>}
        {mode === "Ideas" && <label className="inline-suggestion"><input type="checkbox" checked={guidance === "Suggest improvements"} onChange={(e) => setGuidance(e.target.checked ? "Suggest improvements" : "Use my idea")} />Suggest improvements <span>Optional</span></label>}
        {mode === "Revise" && <label className="field">What should change?<textarea ref={revisionInput} value={feedback} maxLength={4000} onChange={(e) => setFeedback(e.target.value)} placeholder="Optional: tell us what to improve, or let the AI decide." /></label>}
        <details className="workspace-options"><summary>Writing preferences</summary>
          {mode === "Ideas" && <><p className="hint">Suggestions are optional. Uncheck them to use your idea as given.</p><label className="field">Story structure <span className="hint">Optional</span><textarea value={structure} maxLength={2000} onChange={(e) => setStructure(e.target.value)} placeholder="Leave blank and we’ll choose a structure that fits." /></label></>}
          <label className="toggle"><input type="checkbox" checked={context} onChange={(e) => setContext(e.target.checked)} />Use writing from <b>{sourceTitle || "this project"}</b></label>
          <label className="field">Target length · {target} words<input type="range" min={100} max={3000} step={50} value={target} onChange={(e) => setTarget(Number(e.target.value))} /></label>
          {(mode === "Ideas" || mode === "Draft") && <><label className="toggle"><input type="checkbox" checked={refine} onChange={(e) => setRefine(e.target.checked)} />Review and refine automatically</label>{refine && <><label className="field">Maximum revision rounds<select value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n} · stops early when ready</option>)}</select></label><p className="hint">Extra reviews use your connected AI provider.</p></>}</>}
          {source && <div className="atlas-seed"><div><b>{source.title}</b><p>{source.tradition} · {source.place}<br />{label(source.mechanism)}: {source.instruction}</p><button className="text-action" onClick={() => setSource(undefined)}>Remove source</button></div></div>}
        </details>
        <div className="composer-actions">
          <button className="primary" disabled={!ready || !project.id || working || (needsText && !input.trim())} onClick={() => { setSelectedResult(""); void run(); }}><Icon name="pen" size={15} />{working ? "Working…" : mode === "Ideas" ? "Develop my idea" : `${mode} my writing`}</button>
          <button className="text-action" onClick={() => go("atlas")}>{source ? "View inspiration" : "Find inspiration"}</button>
        </div>
        {source && <p className="hint">Inspired by {source.title}</p>}
      </section>
      <section className="results" aria-label="Creative results" hidden={mode === "Ideas"}>
        <div className="workspace-result-head"><h2>Your result</h2>{records.length > 1 && <select aria-label="Saved creative result" value={shown?.id || ""} onChange={(e) => setSelectedResult(e.target.value)}>{records.map((r, i) => <option key={r.id} value={r.id}>{i === 0 ? "Latest" : `Earlier ${records.length - i}`} · {r.result?.title || r.request.operation}</option>)}</select>}</div>
        {liveJob?.preview && <StreamingDraft key={liveJob.id} job={liveJob} />}
        {working && <div className="panel working-note" role="status"><h3>Your writing is underway.</h3><p>Results save here. Try a visual or soundtrack while you wait.</p><div className="comment-actions"><button onClick={() => go("images")}>Create a visual</button><button onClick={() => go("music")}>Create a soundtrack</button><button onClick={() => go("production")}>Plan production</button></div><details><summary>Progress</summary><p>{jobs.find(pending)?.message || "Preparing your request…"}</p></details></div>}
        {loading && !records.length && <p role="status">Loading saved results…</p>}
        {(shown && shown.status !== "running" && !liveJob ? [shown] : []).map((r) => {
          const output = displayOutput(r.result || r.preview || r.steps.at(-1)?.output);
          return <article className="panel result" key={r.id}>
            {r.status !== "complete" && <p className="hint">Unfinished draft · Your partial writing is saved.</p>}
            <div className="finding-head"><h3>{output?.title || r.request.operation}</h3><small>{ago(r.created_at)}</small></div>
            {output?.text && <pre>{output.text}</pre>}
            {output?.summary && <p>{output.summary}</p>}
            {!!output?.issues?.length && <div><h3>Feedback</h3>{output.issues.map((issue, i) => <pre key={i}>{describe(issue)}</pre>)}</div>}
            {!!output?.suggestions?.length && <div className="inline-feedback"><h4>Suggestions <span>Optional</span></h4>{output.suggestions.map((s, i) => <div key={i}><p>{describe(s)}</p><button className="text-action" onClick={() => { setInput(output.text || output.summary || ""); setFeedback(describe(s)); requestAnimationFrame(() => revisionInput.current?.focus()); notify("Suggestion added to your revision. Review it, then choose Revise my writing."); }}>Try this</button></div>)}</div>}
            {output && <div className="comment-actions"><button onClick={() => { setMode("Revise"); setInput(output.text || output.summary || ""); setFeedback(""); }}>Revise this</button><button onClick={async () => { try { await navigator.clipboard.writeText(output.text || describe(output)); notify("Copied"); } catch { notify("Could not copy. Select the text to copy it manually."); } }}>Copy</button>{output.text && r.status === "complete" && <button disabled={!!adopting} onClick={() => { void adopt(r); }}>{adopting === r.id ? "Creating project…" : "Use as project"}</button>}</div>}
            {(!!output?.assumptions?.length || output?.completed_brief) && <details><summary>Story details</summary>
              {!!output?.assumptions?.length && <><h4>Details we filled in</h4><p className="hint">You can change any of these choices.</p><ul>{output.assumptions.map((a, i) => <li key={i}>{describe(a)}</li>)}</ul></>}
              {output?.completed_brief && <dl>{Object.entries(output.completed_brief).map(([key, value]) => <div key={key}><dt>{fieldName(key)}</dt><dd><pre>{describe(value)}</pre></dd></div>)}</dl>}
            </details>}
            <details><summary>Generation details</summary><p className="hint">{r.model} · {r.status} · {r.steps.length} AI calls</p>{r.steps.map((step, index) => <details key={index}><summary>{index + 1}. {step.stage}</summary><pre>{readable(step.output)}</pre></details>)}</details>
          </article>;
        })}
        {!loading && !records.length && !working && <div className="empty illustrated-empty"><BrandSpot kind="book" /><div className="empty-copy"><h3>A little idea is enough.</h3><p>Your developed idea will appear here, ready to shape into a story.</p></div></div>}
      </section>
    </div>
    <details className="workspace-notes"><summary>Notes & ideas</summary><IdeaBoard /></details>
  </div>;
}

function StreamingDraft({ job }: { job: Job }) {
  const box = useRef<HTMLPreElement>(null);
  const following = useRef(true);
  const [paused, setPaused] = useState(false);
  const text = job.preview?.text || job.preview?.summary || "Waiting for the first words…";
  const latest = () => {
    following.current = true; setPaused(false);
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  };
  useLayoutEffect(() => {
    if (following.current && box.current?.getClientRects().length) box.current.scrollTop = box.current.scrollHeight;
  }, [text]);
  return <article className="panel result streaming-result" aria-label="Writing in progress">
    <div className="finding-head"><h3>{job.preview?.title || "Your writing"}</h3><small role="status">{job.preview?.stage} · Writing…</small></div>
    <pre ref={box} tabIndex={0} aria-label="Draft being written" onScroll={() => {
      const el = box.current;
      if (!el || !el.getClientRects().length) return;
      following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      setPaused(!following.current);
    }}>{text}<span className="writing-cursor" aria-hidden="true" /></pre>
    {paused && <button className="text-action" onClick={latest}>Jump to latest</button>}
  </article>;
}

function IdeaBoard() {
  const { store, setStore, notify } = useStudio();
  const ideas = store.ideas;
  const set = (next: typeof ideas) => setStore((s) => ({ ...s, ideas: next }));
  const add = () => { set([...ideas, { id: uid(), label: "NEW IDEA", title: "Untitled idea", body: "", color: "paper-note" }]); notify("Idea added"); };
  return <section className="section"><div className="section-head"><h2>Idea board</h2><button className="text-action" onClick={add}><Icon name="plus" size={15} />Add note</button></div>
    <div className="idea-board">{ideas.map((n) => <div className={`idea-note ${n.color}`} key={n.id}>
      <input value={n.label} aria-label="Note label" onChange={(e) => set(ideas.map((x) => x.id === n.id ? { ...x, label: e.target.value } : x))} />
      <textarea className="idea-title" value={n.title} aria-label="Note title" onChange={(e) => set(ideas.map((x) => x.id === n.id ? { ...x, title: e.target.value } : x))} />
      <textarea value={n.body} aria-label="Note text" onChange={(e) => set(ideas.map((x) => x.id === n.id ? { ...x, body: e.target.value } : x))} />
      <button className="delete-note" onClick={() => set(ideas.filter((x) => x.id !== n.id))}>Remove</button>
    </div>)}<button className="idea-add" onClick={add}><Icon name="plus" />Add note</button></div>
  </section>;
}
