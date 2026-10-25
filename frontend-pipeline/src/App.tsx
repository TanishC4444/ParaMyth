import { lazy, type ReactElement, Suspense, useEffect, useState } from "react"

import { StudioProvider, useStudio } from "./store"

import type { View } from "./types"

import { Icon } from "./ui"

import Journey from "./Journey"

import Workflow from "./views/Workflow"

import Overview from "./views/Overview"

import Projects from "./views/Projects"

import ProjectWorkspace from "./views/ProjectWorkspace"

import Runs from "./views/Runs"

import Creative from "./views/Creative"

import Retrieval from "./views/Retrieval"

import Images from "./views/Images"

import Music from "./views/Music"

import Production from "./views/Production"

import Library from "./views/Library"

import Connections from "./views/Connections"

const Landing = lazy(() => import("./views/Landing"))

const NAV: { group: string; items: [View, string, string][] }[] = [
  {
    group: "Write",
    items: [
      ["overview", "overview", "Overview"],
      ["projects", "projects", "Projects"],
      ["atlas", "atlas", "Story atlas"],
      ["workflow", "ideas", "Project workflow"],
      ["runs", "runs", "Pipelines & runs"],
    ],
  },

  {
    group: "Develop",
    items: [
      ["retrieval", "retrieval", "Literary retrieval"],
    ],
  },

  {
    group: "Workspace",
    items: [
      ["library", "library", "File library"],
      ["connections", "connections", "Connections"],
    ],
  },
]

function Shell() {
  const {
    view,
    go,
    store,
    project,
    toast,
    jobs,
    ready,
    error,
    saving,
    refresh,
  } = useStudio()

  const [mobile, setMobile] = useState(false)

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" })
  }, [view])

  const isLanding = view === "landing" || view === "atlas"
  const [visitedLanding, setVisitedLanding] = useState(isLanding)
  if (isLanding && !visitedLanding) setVisitedLanding(true)

  const active = jobs.filter(
    (r) => r.status === "running" || r.status === "queued",
  ).length

  const pages: Record<Exclude<View, "landing" | "atlas">, ReactElement> = {
    workflow: <Workflow />,
    overview: <Overview />,
    projects: <Projects />,
    project: <ProjectWorkspace />,
    runs: <Runs />,
    creative: <Creative />,

    retrieval: <Retrieval />,
    images: <Images />,
    music: <Music />,
    production: <Production />,
    library: <Library />,
    connections: <Connections />,
  }

  return (
    <>
    {visitedLanding && <div hidden={!isLanding} className="workspace-view">
      <Suspense fallback={<div className="landing-loading" role="status">Opening a world of stories…</div>}>
        <Landing focusAtlas={view === "atlas"} />
      </Suspense>
    </div>}
    <div className="app-shell" hidden={isLanding}>
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <button
          className="workspace-switch branded-workspace"
          aria-label="ParaMyth home"
          onClick={() => go("landing")}
        >
          <img
            className="brand-logo"
            src="/brand/paramyth-logo.png"
            width="1280"
            height="720"
            alt="ParaMyth"
          />
          <small>Back to a world of stories</small>
        </button>
        <nav aria-label="Primary">
          <a className="studio-team-link" href="/studio/teams.html">
            <Icon name="connections" />
            <span>Studio accounts & teams</span>
          </a>
          {NAV.map((g) => (
            <div key={g.group} className="nav-group">
              <span>{g.group}</span>
              {g.items.map(([id, icon, label]) => (
                <button
                  key={id}
                  className={
                    view === id || (id === "projects" && view === "project")
                      ? "active"
                      : ""
                  }
                  onClick={() => {
                    go(id)
                    setMobile(false)
                  }}
                >
                  <Icon name={icon} />
                  <span>{label}</span>
                  {id === "runs" && active > 0 && <em>{active}</em>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="current-project">
            <small>CURRENT PROJECT</small>
            <b>{project.title}</b>
            <span>{project.brief.medium}</span>
          </div>
        </div>
      </aside>
      {mobile && (
        <button
          className="scrim"
          aria-label="Close menu"
          onClick={() => setMobile(false)}
        />
      )}
      <main>
        <header>
          <button
            className="mobile-menu"
            aria-label="Open menu"
            onClick={() => setMobile(true)}
          >
            <Icon name="menu" />
          </button>
          <a className="mobile-brand" href="#/" aria-label="ParaMyth home">
            <img
              className="brand-logo"
              src="/brand/paramyth-logo.png"
              width="1280"
              height="720"
              alt="ParaMyth"
            />
          </a>
          <span className={saving ? "local-label saving" : "local-label"}>
            {saving ? "SAVING YOUR CHANGES…" : "LIVE STUDIO · SAVED TO YOUR WORKSPACE"}
          </span>
          <div className="header-actions">
            <button
              aria-label="Connections"
              className="icon-button"
              onClick={() => go("connections")}
            >
              <Icon name="settings" />
            </button>
            <a className="text-action" href="/studio/teams.html">Sign in</a>
            <a className="text-action" href="/studio/teams.html?mode=signup">Create account</a>
          </div>
        </header>
        {error && (
          <div className="live-error" role="alert">
            {error}
            <button className="secondary" onClick={() => void refresh()}>
              Try again
            </button>
          </div>
        )}
        {!ready ? (
          <p className="live-loading" role="status">
            Opening your saved workspace…
          </p>
        ) : (
          <>
            {!["workflow", "projects", "overview", "connections", "retrieval"].includes(
              view,
            ) && <Journey />}
            {!project.id &&
            ["workflow", "project", "images", "music", "production", "library"].includes(
              view,
            ) ? (
              <div className="story-empty">
                <h2>Start with your story</h2>
                <p>
                  Create a project to keep your writing, images and sound
                  together.
                </p>
                <button className="primary" onClick={() => go("projects")}>
                  Create a story
                </button>
              </div>
            ) : (
              <PageCache key={project.id} pages={pages} view={view} />
            )}
          </>
        )}
      </main>
    </div>
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" />
          {toast}
        </div>
      )}
    </>
  )
}

function PageCache({ pages, view }: { pages: Partial<Record<View, ReactElement>>; view: View }) {
  const [visited, setVisited] = useState<View[]>([])
  if (pages[view] && !visited.includes(view)) setVisited([...visited, view])
  return <>{visited.map((id) => <div className="workspace-view" hidden={id !== view} key={id}>{pages[id]}</div>)}</>
}

export default function App() {
  return (
    <StudioProvider>
      <Shell />
    </StudioProvider>
  )
}
