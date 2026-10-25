import { useEffect } from "react";
import { useDraftState, useStudio } from "../store";
import { useMaterials } from "../materials";
import Creative from "./Creative";
import Images from "./Images";
import Music from "./Music";
import Production from "./Production";
import ProjectWorkspace from "./ProjectWorkspace";

export default function Workflow() {
  const { project, jobs, go, setTab } = useStudio();
  const { writing, images, source, setSource, sourceTitle } = useMaterials();
  const initial = location.hash.split("/").at(-1);
  const [tool, setTool] = useDraftState("workflow.tool", ["images","music","production"].includes(initial || "") ? initial! : "images");
  const [writingPane, setWritingPane] = useDraftState("workflow.writing", initial === "project" ? "manuscript" : "creative");
  const [toolsOpen, setToolsOpen] = useDraftState("workflow.toolsOpen", false);
  const active = jobs.filter((j) => ["running", "queued"].includes(j.status));
  useEffect(() => { if (writingPane === "brief") setTab("brief"); else if (writingPane === "manuscript") setTab("manuscript"); }, [writingPane]);
  return <div className="page project-workflow">
    <header className="workflow-heading"><div><span className="eyebrow">PROJECT WORKFLOW</span><h1>{project.title}</h1><p>Write, create and plan together. Your work saves as you go.</p></div><button onClick={() => go("projects")}>Change project</button></header>
    <section className="workflow-source" aria-label="Shared project materials"><label>Working from<select aria-label="Writing used by visuals, sound and planning" value={source} onChange={(e) => setSource(e.target.value)}><option value="latest">Latest generated writing{writing[0] ? ` · ${writing[0].title}` : ` · ${project.title}`}</option><option value="working">Current editor text</option><option value="manuscript">Current manuscript · {project.title}</option>{writing.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label><span>{writing.length} saved writings · {images.length} visuals</span>{active.length > 0 && <span className="workflow-running" role="status">{active.length} {active.length === 1 ? "task is" : "tasks are"} running</span>}</section>
    <div className="workflow-columns">
      <section className="workflow-writing" aria-label="Story writing"><nav className="workflow-tabs" aria-label="Writing workspace">{[["creative","Ideas & writing"],["manuscript","Manuscript"],["brief","Project brief"]].map(([id,label]) => <button key={id} aria-pressed={writingPane === id} onClick={() => { setWritingPane(id); if (id === "brief" || id === "manuscript") setTab(id); }}>{label}</button>)}</nav>
        <div hidden={writingPane !== "creative"}><Creative /></div>
        <div hidden={writingPane === "creative"}><ProjectWorkspace /></div>
      </section>
      <section className={`workflow-making${toolsOpen ? " tools-open" : " tools-collapsed"}`} aria-label="Create alongside your writing"><nav className="workflow-tabs" aria-label="Create and plan">{[["images","Visuals"],["music","Soundtracks"],["production","Production"]].map(([id,label]) => <button key={id} aria-pressed={tool === id} onClick={() => { setTool(id); setToolsOpen(true); }}>{label}{jobs.some((j) => ["queued","running"].includes(j.status) && (id === "images" ? j.kind.startsWith("image") : j.kind === id)) && <i aria-label="Running" />}</button>)}<button className="workflow-dock-toggle" aria-label={toolsOpen ? "Minimize creation tools" : "Expand creation tools"} aria-expanded={toolsOpen} onClick={() => setToolsOpen(!toolsOpen)}>{toolsOpen ? "−" : "+"}</button></nav><p className="workflow-context">Using {sourceTitle}</p>
        <div hidden={tool !== "images"}><Images /></div>
        <div hidden={tool !== "music"}><Music /></div>
        <div hidden={tool !== "production"}><Production /></div>
      </section>
    </div>
  </div>;
}
