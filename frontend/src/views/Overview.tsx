import { manuscriptLabel, modeOf, QUEUE_LIMIT, WORKERS } from "../data";
import { useStudio } from "../store";
import { ago, Icon, Status } from "../ui";
import { BrandScene, ProjectCover } from "../brandArt";

export default function Overview() {
  const { store, project, selectProject, go, jobs } = useStudio();
  const accepted = project.scenes.filter((s) => s.state === "Accepted").length;
  const awaiting = store.projects.flatMap((p) => p.scenes.filter((s) => s.state === "In review").map((s) => ({ p, s })));
  const active = jobs.filter((r) => r.status === "running" || r.status === "queued");
  const running = active.filter((r) => r.status === "running").length;
  const blocking = project.scenes.flatMap((s) => s.findings).filter((f) => f.status === "Open" && f.severity === "Blocking").length;

  return <div className="page overview-page">
    <section className="studio-welcome"><div><h1>{project.id ? "Welcome back" : "Start your first story"}</h1><p>{project.id ? "Pick up a project, start a new one, or look for ideas in the story atlas." : "Write a short brief and ParaMyth sets up the chapters, canon and tools around it."}</p><div className="hero-actions"><button className="primary" onClick={() => go("projects")}><Icon name={project.id ? "projects" : "plus"} />{project.id ? "Open projects" : "Create a story"}</button><button className="text-action" onClick={() => go("atlas")}>Explore the atlas <Icon name="arrow" size={15} /></button></div></div><BrandScene className="studio-welcome-art" /></section>

    {project.id && <section className="section"><div className="section-head"><h2>Pick up where you left off</h2></div>
      <button className="continue-card" onClick={() => project.id ? selectProject(project.id, "manuscript") : go("projects")}>
        <div className="cover illustrated-cover"><ProjectCover project={project} /><span>{project.brief.medium}</span></div>
        <div className="continue-content"><Status>{manuscriptLabel(project)}</Status><h3>{project.title}</h3><p>{project.brief.premise}</p>
          <div className="meta-row"><span>Edited {ago(project.updated)}</span><span><Icon name="canon" size={16} />{project.canon.filter((f) => f.state === "Accepted").length} accepted facts</span>{blocking > 0 && <span className="warn"><Icon name="alert" size={16} />{blocking} blocking findings</span>}</div>
          <div className="progress"><span style={{ width: `${project.scenes.length ? (accepted / project.scenes.length) * 100 : 0}%` }} /></div><small>{accepted} of {project.scenes.length} scenes accepted into canon</small></div>
        <span className="round-arrow"><Icon name="arrow" /></span>
      </button>
    </section>}

    <div className="overview-grid">
      <section className="section"><div className="section-head"><h2>Story projects</h2><button className="text-action" onClick={() => go("projects")}>All projects <Icon name="arrow" size={15} /></button></div>
        <div className="project-list">{store.projects.slice(0, 5).map((p) => <button key={p.id} className="project-row" onClick={() => selectProject(p.id)}>
          <div className="mini-cover illustrated-cover"><ProjectCover project={p} /></div>
          <div className="project-name"><b>{p.title}</b><small>{p.brief.medium} · {p.owner}</small></div>
          <Status>{manuscriptLabel(p)}</Status><span className="due">{p.scenes.filter((s) => s.state === "Accepted").length}/{p.scenes.length}</span><span>›</span>
        </button>)}{!store.projects.length && <p className="quiet pad">No projects yet. Your stories will be listed here.</p>}</div>
      </section>
      <aside className="right-rail">
        <section className="panel"><div className="section-head"><h2>Background jobs</h2><span className="count">{active.length}</span></div>
          <div className="capacity"><div><b>{running}</b><small>workers busy</small></div><div><b>{active.length}</b><small>queued or running</small></div></div>
          {active.length ? active.map((r) => <button className="mini-run" key={r.id} onClick={() => go("runs")}><b>{r.kind}</b><small>{r.status} · {r.message}</small></button>) : <p className="quiet">Nothing running right now.</p>}
        </section>
        <section className="panel review-panel"><div className="section-head"><h2>Scenes in review</h2><span className="count">{awaiting.length}</span></div>
          {awaiting.length ? awaiting.map(({ p, s }) => <button key={s.id} onClick={() => selectProject(p.id, "manuscript")}><b>{s.title}</b><small>{p.title} · {s.findings.filter((f) => f.status === "Open").length} open findings</small><span>Review evidence →</span></button>) : <p className="quiet">No scenes waiting on review.</p>}
        </section>
      </aside>
    </div>
  </div>;
}
