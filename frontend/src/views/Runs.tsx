import { useState } from "react";
import { MODES, modeOf, QUEUE_LIMIT, WORKERS } from "../data";
import { useStudio } from "../store";
import type { RunStatus } from "../types";
import { ago, fmtTime, Icon, PageTitle, Status } from "../ui";

export default function Runs() {
  const { store, runAction, selectProject } = useStudio();
  const [status, setStatus] = useState<RunStatus | "All">("All"), [mode, setMode] = useState("All"), [openId, setOpenId] = useState(store.runs[0]?.id || "");
  const runs = store.runs.filter((r) => (status === "All" || r.status === status) && (mode === "All" || r.mode === mode));
  const run = store.runs.find((r) => r.id === openId);
  const projectOf = (id: string) => store.projects.find((p) => p.id === id);
  const active = store.runs.filter((r) => r.status === "Running" || r.status === "Queued").length;
  return <div className="page">
    <PageTitle eyebrow="GITHUB ACTIONS" title="Pipelines & runs" text={`Workflow history across projects. ${WORKERS} workers, up to ${QUEUE_LIMIT} queued or running. A finished run is not the same as accepted canon.`}><span className="local-label">{active}/{QUEUE_LIMIT} ACTIVE</span></PageTitle>
    <div className="toolbar">
      <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as RunStatus | "All")}><option>All</option>{(["Queued", "Running", "Succeeded", "Failed", "Cancelled", "Interrupted"] as const).map((s) => <option key={s}>{s}</option>)}</select>
      <select aria-label="Mode" value={mode} onChange={(e) => setMode(e.target.value)}><option value="All">All modes</option>{MODES.map((m) => <option value={m.id} key={m.id}>{m.name}</option>)}</select>
    </div>
    <div className="runs-layout">
      <div className="review-list">{runs.map((r) => <button className={`review-item run-row ${r.id === openId ? "selected" : ""}`} key={r.id} onClick={() => setOpenId(r.id)}>
        <code>{r.id}</code><div><Status>{r.status}</Status><h3>{modeOf(r.mode).name}</h3><p>{projectOf(r.projectId)?.title} · {r.stage} · {ago(r.started)}</p></div>
        <div className="progress"><span style={{ width: `${r.progress * 100}%` }} /></div>
      </button>)}{!runs.length && <p className="quiet pad">No runs match.</p>}</div>
      {run && <aside className="panel run-detail">
        <span className="eyebrow">{modeOf(run.mode).workflow}</span><h2>{run.id}</h2>
        <p className="quiet">{projectOf(run.projectId)?.title}{run.recoveredFrom ? ` · recovered from ${run.recoveredFrom}` : ""}</p>
        <ol className="stages">{modeOf(run.mode).stages.map((s, i, all) => { const at = Math.floor(run.progress * all.length); return <li key={s} className={i < at || run.progress >= 1 ? "done" : i === at ? (run.status === "Running" ? "current" : run.status === "Failed" ? "failed" : "") : ""}>{s}</li>; })}</ol>
        <h3>Events</h3>
        <ul className="timeline">{[...run.events].reverse().map((e, i) => <li key={i}><small>{fmtTime(e.at)}</small>{e.text}</li>)}</ul>
        <div className="detail-actions">
          {(run.status === "Running" || run.status === "Queued") && <button className="secondary" onClick={() => runAction(run.id, "cancel")}><Icon name="stop" size={15} />Cancel run</button>}
          {(run.status === "Failed" || run.status === "Interrupted" || run.status === "Cancelled") && <button className="primary" onClick={() => runAction(run.id, "recover")}><Icon name="refresh" size={15} />Fresh recovery</button>}
          <button className="secondary" onClick={() => selectProject(run.projectId, "manuscript")}>Open manuscript</button>
        </div>
        <p className="hint">Fresh recovery starts a new run that keeps the approved prefix and saved drafts; unfinished text gets fresh checks and does not inherit earlier approval.</p>
      </aside>}
    </div>
  </div>;
}
