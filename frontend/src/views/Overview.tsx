import { useState } from "react";
import { manuscriptLabel } from "../data";
import { useStudio } from "../store";
import { ago, Icon, PageTitle, Status } from "../ui";
import { ProjectCover } from "../brandArt";
import { CreateProjectDialog } from "./Projects";
import { useAccess } from "../AccountGate";

export default function Overview() {
  const { store, project, selectProject, go, jobs } = useStudio();
  const { studio } = useAccess();
  const [create, setCreate] = useState(false);
  const awaiting = store.projects.flatMap(p => p.scenes.filter(s => s.state === "In review").map(s => ({ p, s })));
  const active = jobs.filter(r => r.status === "running" || r.status === "queued");
  const accepted = store.projects.reduce((count, p) => count + p.scenes.filter(s => s.state === "Accepted").length, 0);
  const currentAccepted = project.scenes.filter(s => s.state === "Accepted").length;
  const recent = [...store.projects].filter(p => p.id !== project.id).sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 3);
  const metrics = [
    { icon: "projects", label: "Projects", value: store.projects.length, detail: studio ? "In this team workspace" : "In your workspace", view: "projects" as const },
    { icon: "pen", label: "Scenes in review", value: awaiting.length, detail: "Ready for your attention", view: "projects" as const },
    { icon: "runs", label: "Active jobs", value: active.length, detail: "Queued or in progress", view: "runs" as const },
    { icon: "check", label: "Accepted scenes", value: accepted, detail: "Across all your projects", view: "projects" as const },
  ];
  return <div className="page overview-page">
    <PageTitle eyebrow="WORKSPACE" title="Overview" text="Your projects, progress and next steps in one place.">
      {studio?.role !== "viewer" && <button className="primary" onClick={() => setCreate(true)}><Icon name="plus" size={17} />New project</button>}
    </PageTitle>
    <section className="workspace-metrics" aria-label="Workspace summary">{metrics.map(metric => <button key={metric.label} className="workspace-metric" onClick={() => go(metric.view)}><span className="metric-label"><Icon name={metric.icon} size={17} />{metric.label}</span><b>{metric.value}</b><small>{metric.detail}</small></button>)}</section>
    <div className="overview-grid">
      <div className="overview-main">
        <section className="section">{project.id && <div className="section-head"><h2>Continue working</h2><button className="text-action" onClick={() => go("projects")}>View projects<Icon name="arrow" size={15} /></button></div>}
          {project.id ? <button className="continue-card" onClick={() => selectProject(project.id, "manuscript")}>
            <div className="cover illustrated-cover"><ProjectCover project={project} /></div>
            <div className="continue-content"><div className="resume-meta"><span>{project.brief.medium}</span><Status>{manuscriptLabel(project)}</Status></div><h3>{project.title}</h3><p>{project.brief.premise || "Add a premise to give your story a direction."}</p><div className="resume-progress"><span>{currentAccepted} of {project.scenes.length} scenes accepted</span><span>Edited {ago(project.updated)}</span></div><div className="progress" role="progressbar" aria-label="Accepted scenes" aria-valuemin={0} aria-valuemax={Math.max(1, project.scenes.length)} aria-valuenow={currentAccepted}><span style={{ width: `${project.scenes.length ? currentAccepted / project.scenes.length * 100 : 0}%` }} /></div><span className="resume-action">Open workspace<Icon name="arrow" size={16} /></span></div>
          </button> : <div className="studio-onboarding"><span className="eyebrow">FROM FIRST IDEA TO FINAL DRAFT</span><h2>Make room for your story.</h2><p>Start with a brief. Develop your writing, explore the world around it, and keep every part of the project together.</p>{studio?.role !== "viewer" ? <button className="primary" onClick={() => setCreate(true)}><Icon name="plus" size={17} />Create your first project</button> : <p className="hint">Ask a team owner or editor to create a project.</p>}<ol><li><span>01</span><div><b>Set the direction</b><p>Capture the premise, format and characters.</p></div></li><li><span>02</span><div><b>Develop the story</b><p>Write, revise and review each chapter.</p></div></li><li><span>03</span><div><b>Bring it to life</b><p>Build visuals, sound and a production plan.</p></div></li></ol></div>}
        </section>
        {!!recent.length && <section className="section"><div className="section-head"><h2>Other recent projects</h2></div><div className="project-list">{recent.map(p => <button className="project-row" key={p.id} onClick={() => selectProject(p.id)}><div className="mini-cover illustrated-cover"><ProjectCover project={p} /></div><div className="project-name"><b>{p.title}</b><small>{p.brief.medium} · Edited {ago(p.updated)}</small></div><Status>{manuscriptLabel(p)}</Status><Icon name="arrow" size={16} /></button>)}</div></section>}
      </div>
      <aside className="right-rail">
        <section className="panel review-panel"><div className="section-head"><h2>Needs review</h2><span className="count">{awaiting.length}</span></div>{awaiting.length ? awaiting.slice(0, 4).map(({p, s}) => <button className="attention-row" key={`${p.id}-${s.id}`} onClick={() => selectProject(p.id, "manuscript")}><Icon name="pen" size={17} /><span><b>{s.title}</b><small>{p.title}</small></span><Icon name="arrow" size={15} /></button>) : <div className="rail-empty"><span className="rail-icon"><Icon name="check" size={20} /></span><h3>You’re all caught up</h3><p>Scenes ready for review will appear here.</p></div>}</section>
        <section className="panel"><div className="section-head"><h2>Background activity</h2><button className="text-action" onClick={() => go("runs")}>View all<Icon name="arrow" size={14} /></button></div>{active.length ? active.slice(0, 4).map(job => <button className="mini-run" key={job.id} onClick={() => go("runs")}><b>{job.kind.replace(/_/g, " ")}</b><Status>{job.status}</Status><small>{job.message}</small></button>) : <p className="quiet">No jobs running. Your workspace is ready when you are.</p>}</section>
        <button className="discovery-card" onClick={() => go("retrieval")}><span className="discovery-icon"><Icon name="atlas" size={24} /></span><span className="eyebrow">LOOKING FOR A STARTING POINT?</span><h2>Find a story worth retelling.</h2><p>Explore myths, fairy tales and epics in the story atlas.</p><span className="text-action">Explore the atlas<Icon name="arrow" size={16} /></span></button>
      </aside>
    </div>
    {create && <CreateProjectDialog close={() => setCreate(false)} />}
  </div>;
}
