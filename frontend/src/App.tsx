import { type ReactElement, useState } from "react";
import { StudioProvider, useStudio } from "./store";
import type { View } from "./types";
import { Icon } from "./ui";
import Overview from "./views/Overview";
import Projects from "./views/Projects";
import ProjectWorkspace from "./views/ProjectWorkspace";
import Runs from "./views/Runs";
import Creative from "./views/Creative";
import Retrieval from "./views/Retrieval";
import Images from "./views/Images";
import Music from "./views/Music";
import Production from "./views/Production";
import Library from "./views/Library";
import Connections from "./views/Connections";

const NAV: { group: string; items: [View, string, string][] }[] = [
  { group: "Write", items: [["overview", "overview", "Overview"], ["projects", "projects", "Projects"], ["creative", "ideas", "Creative workspace"], ["runs", "runs", "Pipelines & runs"]] },
  { group: "Develop", items: [["retrieval", "retrieval", "Literary retrieval"], ["images", "images", "Images"], ["music", "music", "Soundtracks"], ["production", "production", "Production"]] },
  { group: "Workspace", items: [["library", "library", "File library"], ["connections", "connections", "Connections"]] },
];

function Shell() {
  const { view, go, store, project, toast } = useStudio();
  const [mobile, setMobile] = useState(false);
  const active = store.runs.filter((r) => r.status === "Running" || r.status === "Queued").length;
  const pages: Record<View, ReactElement> = {
    overview: <Overview />, projects: <Projects />, project: <ProjectWorkspace />, runs: <Runs />, creative: <Creative />,
    retrieval: <Retrieval />, images: <Images />, music: <Music />, production: <Production />, library: <Library />, connections: <Connections />,
  };
  return <div className="app-shell">
    <aside className={`sidebar ${mobile ? "open" : ""}`}>
      <button className="workspace-switch" onClick={() => go("connections")}><span className="workspace-mark">P</span><div><b>ParaMyth</b><small>Studio · Local demo</small></div></button>
      <nav aria-label="Primary">
        {NAV.map((g) => <div key={g.group} className="nav-group"><span>{g.group}</span>
          {g.items.map(([id, icon, label]) => <button key={id} className={view === id || (id === "projects" && view === "project") ? "active" : ""} onClick={() => { go(id); setMobile(false); }}>
            <Icon name={icon} /><span>{label}</span>{id === "runs" && active > 0 && <em>{active}</em>}
          </button>)}
        </div>)}
      </nav>
      <div className="sidebar-bottom"><div className="current-project"><small>CURRENT PROJECT</small><b>{project.title}</b><span>{project.brief.medium}</span></div></div>
    </aside>
    {mobile && <button className="scrim" aria-label="Close menu" onClick={() => setMobile(false)} />}
    <main>
      <header>
        <button className="mobile-menu" aria-label="Open menu" onClick={() => setMobile(true)}><Icon name="menu" /></button>
        <div className="mobile-brand">ParaMyth</div>
        <span className="local-label">LOCAL DEMO · SAVED IN THIS BROWSER</span>
        <div className="header-actions"><button aria-label="Connections" className="icon-button" onClick={() => go("connections")}><Icon name="settings" /></button><div className="avatar small">MC</div></div>
      </header>
      {pages[view]}
    </main>
    {toast && <div className="toast" role="status"><Icon name="check" />{toast}</div>}
  </div>;
}

export default function App() {
  return <StudioProvider><Shell /></StudioProvider>;
}
