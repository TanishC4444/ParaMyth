import { useState } from "react";
import { now, seedProjects, uid, words } from "../data";
import { useStudio } from "../store";
import type { CreativeMode, CreativeResult, Project } from "../types";
import { ago, Icon, PageTitle, Segmented } from "../ui";

const MODES: CreativeMode[] = ["Ideas", "Draft", "Review", "Revise"];
const HELP: Record<CreativeMode, string> = {
  Ideas: "One recommendation plus three alternatives from a short brief.",
  Draft: "Writes a passage from a brief at the target length.",
  Review: "Critiques supplied text. Advisory only — never commits canon.",
  Revise: "Applies feedback to supplied text.",
};

/** Placeholder generator: the studio API produces real model output; this keeps the flow testable offline. */
function localResult(mode: CreativeMode, input: string, feedback: string, target: number, rounds: number, context: string): string {
  const seed = input.trim() || "an untitled idea";
  if (mode === "Ideas") return `Recommendation: ${seed} — told from the point of view of whoever loses most if it succeeds.\n\nAlternative 1: Reverse the order; open on the consequence.\nAlternative 2: Give the central object a keeper with a private reason to lie.\nAlternative 3: Restrict the story to one night and one location.${context ? `\n\nGrounded in: ${context}` : ""}`;
  if (mode === "Review") return `Findings (${rounds} round${rounds > 1 ? "s" : ""}):\n• Opening line states the theme instead of dramatising it.\n• ${words(input)} words; the turn arrives late.\n• Dialogue explains motive the action already shows.\n\nVerdict: revise. This review applies to the text as submitted.`;
  if (mode === "Revise") return `${input.trim()}\n\n[Revision applying: ${feedback || "no feedback supplied"} · ${rounds} critique/revision round${rounds > 1 ? "s" : ""}]`;
  return `[Draft · target ${target} words${context ? " · with story context" : ""}]\n\n${seed.charAt(0).toUpperCase() + seed.slice(1)}. The first thing anyone noticed was the quiet. Then, slowly, the reason for it.`;
}

export default function Creative() {
  const { store, setStore, project, selectProject, notify } = useStudio();
  const [mode, setMode] = useState<CreativeMode>("Ideas"), [input, setInput] = useState(""), [feedback, setFeedback] = useState(""), [target, setTarget] = useState(600), [rounds, setRounds] = useState(1), [context, setContext] = useState(true);
  const needsText = mode === "Review" || mode === "Revise";
  const run = () => {
    const ctx = context ? `${project.title} — ${project.brief.premise}` : "";
    const r: CreativeResult = { id: uid(), mode, input, output: localResult(mode, input, feedback, target, rounds, ctx), rounds, words: target, context, created: now() };
    setStore((s) => ({ ...s, creative: [r, ...s.creative] }));
    notify(`${mode} saved · ${mode === "Draft" ? 1 : 1 + rounds * 2} max calls`);
  };
  const adopt = (r: CreativeResult) => {
    const base = seedProjects()[0];
    const p: Project = { ...base, id: uid(), title: `From ${r.mode.toLowerCase()} · ${new Date(r.created).toLocaleDateString()}`, updated: now(), canon: [], versions: [], brief: { ...base.brief, premise: r.input || r.output.slice(0, 200), characters: [] }, scenes: [{ id: uid(), chapter: 1, title: "Opening", pov: "", location: "", content: r.output, state: "Draft", findings: [], minutes: 4, night: false }] };
    setStore((s) => ({ ...s, projects: [p, ...s.projects] }));
    selectProject(p.id, "brief");
    notify("Adopted as a new project");
  };

  return <div className="page">
    <PageTitle eyebrow="MANUAL CREATIVE WORKSPACE" title="Creative workspace" text="Bounded idea and prose loops. Results are saved and can be revised or adopted as a project; advisory reviews never change canon." />
    <div className="creative-layout">
      <section className="panel">
        <Segmented label="Creative mode" value={mode} options={MODES} onChange={setMode} />
        <p className="hint">{HELP[mode]}</p>
        <label className="field">{needsText ? "Text" : "Brief"}<textarea className="tall" value={input} maxLength={needsText ? 20000 : 2000} onChange={(e) => setInput(e.target.value)} placeholder={needsText ? "Paste the passage" : "What should this explore?"} /></label>
        {mode === "Revise" && <label className="field">Feedback<textarea value={feedback} maxLength={4000} onChange={(e) => setFeedback(e.target.value)} placeholder="What should change?" /></label>}
        <div className="form-grid">
          <label className="field">Target length · {target} words<input type="range" min={100} max={3000} step={50} value={target} onChange={(e) => setTarget(Number(e.target.value))} /></label>
          <label className="field">Critique / revision rounds<select value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n} round{n > 1 ? "s" : ""} · stops early on a pass</option>)}</select></label>
        </div>
        <label className="toggle"><input type="checkbox" checked={context} onChange={(e) => setContext(e.target.checked)} />Use story context from <b>{project.title}</b></label>
        <button className="primary" disabled={needsText && !input.trim()} onClick={run}><Icon name="sparkle" size={15} />Run {mode.toLowerCase()}</button>
        <p className="hint">Offline demo output. Connect the ParaMyth studio API for model-generated results.</p>
      </section>
      <section className="results">
        {store.creative.map((r) => <article className="panel result" key={r.id}>
          <div className="finding-head"><b>{r.mode}</b><small>{ago(r.created)} · {r.rounds} round{r.rounds > 1 ? "s" : ""}{r.context ? " · story context" : ""}</small></div>
          <pre>{r.output}</pre>
          <div className="comment-actions"><button onClick={() => { setMode("Revise"); setInput(r.output); }}>Copy into revise</button><button onClick={() => { navigator.clipboard?.writeText(r.output); notify("Copied"); }}>Copy</button><button onClick={() => adopt(r)}>Use as project</button></div>
        </article>)}
        {!store.creative.length && <div className="empty"><Icon name="ideas" /><h3>No creative results yet</h3><p>Every step and its settings are kept here.</p></div>}
      </section>
    </div>
    <IdeaBoard />
  </div>;
}

function IdeaBoard() {
  const { store, setStore, notify } = useStudio();
  const ideas = store.ideas;
  const set = (next: typeof ideas) => setStore((s) => ({ ...s, ideas: next }));
  const add = () => { set([...ideas, { id: uid(), label: "NEW IDEA", title: "Untitled idea", body: "Add your thought here.", color: "paper-note" }]); notify("Idea added"); };
  return <section className="section"><div className="section-head"><div><span className="eyebrow">CREATIVE SPACE</span><h2>Idea board</h2></div><button className="text-action" onClick={add}><Icon name="plus" size={15} />Add note</button></div>
    <div className="idea-board">{ideas.map((n) => <div className={`idea-note ${n.color}`} key={n.id}>
      <input value={n.label} aria-label="Note label" onChange={(e) => set(ideas.map((x) => x.id === n.id ? { ...x, label: e.target.value } : x))} />
      <textarea className="idea-title" value={n.title} aria-label="Note title" onChange={(e) => set(ideas.map((x) => x.id === n.id ? { ...x, title: e.target.value } : x))} />
      <textarea value={n.body} aria-label="Note text" onChange={(e) => set(ideas.map((x) => x.id === n.id ? { ...x, body: e.target.value } : x))} />
      <button className="delete-note" onClick={() => set(ideas.filter((x) => x.id !== n.id))}>Remove</button>
    </div>)}<button className="idea-add" onClick={add}><Icon name="plus" />Add something</button></div>
  </section>;
}
