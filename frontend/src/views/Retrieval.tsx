import { useMemo, useState } from "react";
import { CORPUS, uid } from "../data";
import { useStudio } from "../store";
import type { Pin } from "../types";
import { Icon, PageTitle, Segmented } from "../ui";

type Mode = "Focused adaptation" | "Balanced" | "Combinatory";
type Adapt = "Mechanism" | "Structural echo" | "Comparative";
const tokens = (s: string) => s.toLowerCase().match(/[a-z]+/g) || [];

export default function Retrieval() {
  const { store, setStore, project, notify } = useStudio();
  const [q, setQ] = useState("an offer that feels dangerous but believable"), [mode, setMode] = useState<Mode>("Balanced"), [adapt, setAdapt] = useState<Adapt>("Mechanism"), [strength, setStrength] = useState(0.4);
  const [w, setW] = useState({ semantic: 0.5, keyword: 0.3, mechanism: 0.2 });
  const sum = Math.round((w.semantic + w.keyword + w.mechanism) * 100) / 100;
  const valid = sum === 1;
  const facets = [...project.brief.themes, ...project.brief.worldRules].join(" ");

  const results = useMemo(() => {
    const qt = new Set([...tokens(q), ...tokens(facets)]);
    const scored = CORPUS.map((r) => {
      const body = new Set(tokens(`${r.title} ${r.text} ${r.tags.join(" ")}`));
      const kw = [...qt].filter((t) => body.has(t)).length / Math.max(1, qt.size);
      const sem = r.tags.filter((t) => [...qt].some((x) => x.startsWith(t.slice(0, 4)))).length / r.tags.length;
      const mech = tokens(r.mechanism).filter((t) => qt.has(t)).length / tokens(r.mechanism).length;
      return { ...r, kw, sem, mech, score: w.semantic * sem + w.keyword * kw + w.mechanism * mech };
    }).sort((a, b) => b.score - a.score);
    if (mode === "Focused adaptation") { const top = scored[0]; return [top, ...scored.slice(1).filter((r) => r.collection === top.collection), ...scored.slice(1).filter((r) => r.collection !== top.collection)].slice(0, 5); }
    if (mode === "Combinatory") { const seen = new Set<string>(); const pick = scored.filter((r) => !seen.has(r.collection) && seen.add(r.collection)); return [...pick, ...scored.filter((r) => !pick.includes(r))].slice(0, 5); }
    return scored.slice(0, 5);
  }, [q, facets, w, mode]);

  const pins = store.pins.filter((p) => p.projectId === project.id);
  const pin = (recordId: string) => {
    if (pins.some((p) => p.recordId === recordId)) return notify("Already pinned");
    const p: Pin = { id: uid(), projectId: project.id, recordId, scope: "Story", purpose: adapt };
    setStore((s) => ({ ...s, pins: [...s.pins, p] }));
    notify("Pinned as explicit reference");
  };
  const setPin = (id: string, patch: Partial<Pin>) => setStore((s) => ({ ...s, pins: s.pins.map((p) => p.id === id ? { ...p, ...patch } : p) }));

  return <div className="page">
    <PageTitle eyebrow="LITERARY RAG" title="Literary retrieval" text="Hybrid search over the literary corpus: semantic similarity, keyword match and narrative-mechanism match. Retrieved examples inform craft; they never become canon." />
    <div className="retrieval-layout">
      <section className="panel">
        <label className="field">Query<textarea value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <p className="hint">Facets from <b>{project.title}</b>: {facets || "none — add themes and world rules on the Brief tab"}</p>
        <div className="field">Retrieval mode<Segmented label="Retrieval mode" value={mode} options={["Focused adaptation", "Balanced", "Combinatory"] as const} onChange={setMode} /></div>
        <h3>Weights</h3>
        {(["semantic", "keyword", "mechanism"] as const).map((k) => <label className="field slider" key={k}>{k[0].toUpperCase() + k.slice(1)} <b>{w[k].toFixed(2)}</b><input type="range" min={0} max={1} step={0.05} value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} /></label>)}
        <p className={valid ? "ok" : "stale"}>{valid ? <><Icon name="check" size={15} />Weights sum to 1.00</> : `Weights must sum to 1.00 (now ${sum.toFixed(2)})`}</p>
        <h3>Adaptation</h3>
        <Segmented label="Adaptation" value={adapt} options={["Mechanism", "Structural echo", "Comparative"] as const} onChange={setAdapt} />
        <label className="field slider">Requested influence <b>{Math.round(strength * 100)}%</b><input type="range" min={0} max={1} step={0.1} value={strength} onChange={(e) => setStrength(Number(e.target.value))} /></label>
        <p className="hint">Requested influence is an instruction to writers, not a measured borrowing claim.</p>
      </section>
      <section>
        {valid ? results.map((r, i) => <article className="panel source" key={r.id}>
          <div className="finding-head"><b>#{i + 1} {r.title}</b><small>{r.id} · {r.collection}</small><span>{r.score.toFixed(3)}</span></div>
          <p>{r.text}</p>
          <div className="score-bars"><span>semantic<i style={{ width: `${r.sem * 100}%` }} /></span><span>keyword<i style={{ width: `${r.kw * 100}%` }} /></span><span>mechanism<i style={{ width: `${r.mech * 100}%` }} /></span></div>
          <div className="tag-row"><em>{r.mechanism}</em>{r.tags.map((t) => <span key={t}>{t}</span>)}</div>
          <button className="text-action" onClick={() => pin(r.id)}><Icon name="pin" size={15} />Pin reference</button>
        </article>) : <div className="empty"><Icon name="alert" /><h3>Search disabled</h3><p>Weights must sum to one.</p></div>}
        <section className="panel"><span className="eyebrow">EXPLICIT REFERENCES</span><h2>Pinned for {project.title}</h2>
          {pins.map((p) => { const r = CORPUS.find((x) => x.id === p.recordId)!; return <div className="pin-row" key={p.id}><b>{r.title}</b>
            <select aria-label="Scope" value={p.scope} onChange={(e) => setPin(p.id, { scope: e.target.value as Pin["scope"] })}><option>Story</option><option>Chapter</option><option>Scene</option></select>
            <input aria-label="Purpose" value={p.purpose} onChange={(e) => setPin(p.id, { purpose: e.target.value })} />
            <button className="link" onClick={() => setStore((s) => ({ ...s, pins: s.pins.filter((x) => x.id !== p.id) }))}>Remove</button></div>; })}
          {!pins.length && <p className="quiet">Pinned records are handled separately from general retrieval and bounded per scene.</p>}
        </section>
      </section>
    </div>
  </div>;
}
