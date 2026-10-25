import { lazy, type ReactElement, Suspense, useEffect, useState } from "react"

import { StudioProvider, useStudio } from "./store"
import AccountGate, { useAccess } from './AccountGate'

import type { View } from "./types"

import { Icon } from "./ui"

import Journey from "./Journey"

import { STATIC_SITE } from "./site"

import { AppErrorBoundary, NotFound, PageLoading } from "./system-pages"

const Legal = lazy(() => import("./Legal"))

const StaticStudio = lazy(() => import("./StaticStudio"))

const Workflow = lazy(() => import("./views/Workflow"))

const Overview = lazy(() => import("./views/Overview"))

const Projects = lazy(() => import("./views/Projects"))

const ProjectWorkspace = lazy(() => import("./views/ProjectWorkspace"))

const Runs = lazy(() => import("./views/Runs"))

const Creative = lazy(() => import("./views/Creative"))

const Retrieval = lazy(() => import("./views/Retrieval"))

const Images = lazy(() => import("./views/Images"))

const Music = lazy(() => import("./views/Music"))

const Production = lazy(() => import("./views/Production"))

const Library = lazy(() => import("./views/Library"))

const Connections = lazy(() => import("./views/Connections"))

const News = lazy(() => import("./views/News"))

const Landing = lazy(() => import("./views/Landing"))

const TITLES: Partial<Record<View, string>> = {
  atlas: "Story atlas",
  overview: "Studio overview",
  projects: "Projects",
  workflow: "Project workflow",
  runs: "Pipelines & runs",
  retrieval: "Literary retrieval",
  library: "File library",
  news: "Industry news",
  connections: "Connections",
  notfound: "Page not found",
}

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
      ["news", "news", "Industry news"],
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
  const access = useAccess()
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
    if (view === "legal") return
    const title = TITLES[view]
    document.title = title ? `${title} · ParaMyth` : "ParaMyth · A world of stories"
  }, [view])

  useEffect(() => {
    // The landing sequence owns its scroll position, including return visits.
    if (view === "landing" || view === "atlas") return
    window.scrollTo({ top: 0, behavior: "instant" })
  }, [view])

  const isLanding = view === "landing" || view === "atlas"
  const missing = view === "notfound"
  const legal = view === "legal"
  const [visitedLanding, setVisitedLanding] = useState(isLanding)
  if (isLanding && !visitedLanding) setVisitedLanding(true)

  const active = jobs.filter(
    (r) => r.status === "running" || r.status === "queued",
  ).length

  const pages: Record<Exclude<View, "landing" | "atlas" | "notfound" | "legal">, ReactElement> = {
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
    news: <News />,
    connections: <Connections />,
  }

  return (
    <>
    {visitedLanding && <div hidden={!isLanding} className="workspace-view">
      <AppErrorBoundary resetKey={view}>
        <Suspense fallback={<div className="night-page"><PageLoading label="Loading ParaMyth…" /></div>}>
          <Landing focusAtlas={view === "atlas"} active={isLanding} />
        </Suspense>
      </AppErrorBoundary>
    </div>}
    {missing && <NotFound />}
    {legal && <AppErrorBoundary resetKey={location.hash}><Suspense fallback={<div className="night-page"><PageLoading /></div>}><Legal key={location.hash} /></Suspense></AppErrorBoundary>}
    {STATIC_SITE ? !isLanding && !missing && !legal && <AppErrorBoundary resetKey={view}><Suspense fallback={<div className="night-page"><PageLoading /></div>}><StaticStudio /></Suspense></AppErrorBoundary> :
    <div className="app-shell" hidden={isLanding || missing || legal}>
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <button
          className="workspace-switch branded-workspace"
          aria-label="ParaMyth home"
          onClick={() => go("landing")}
        >
          <img
            className="brand-logo"
            src="/brand/paramyth-logo.webp"
            width="400"
            height="225"
            loading="lazy"
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
            <small>Current project</small>
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
              src="/brand/paramyth-logo.webp"
              width="400"
              height="225"
              loading="lazy"
              alt="ParaMyth"
            />
          </a>
          <span className={saving ? "local-label saving" : "local-label"}>
            {saving ? "Saving…" : "All changes saved"}
          </span>
          <div className="header-actions">
            <button
              aria-label="Connections"
              className="icon-button"
              onClick={() => go("connections")}
            >
              <Icon name="settings" />
            </button>
            <a className="text-action" href={access.authenticated ? "/studio/teams.html" : "#/signin"}>{access.authenticated ? "Account" : "Sign in"}</a>
            {!access.authenticated && <a className="text-action" href="#/signup">Create account</a>}
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
          <PageLoading label="Opening your saved workspace…" light />
        ) : (
          <>
            {!["workflow", "projects", "overview", "connections", "retrieval", "news"].includes(
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
              <AppErrorBoundary resetKey={view}>
                <Suspense fallback={<PageLoading light />}>
                  <PageCache key={project.id} pages={pages} view={view} />
                </Suspense>
              </AppErrorBoundary>
            )}
          </>
        )}
      </main>
    </div>}
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
    <AppErrorBoundary><AccountGate><StudioProvider>
      <Shell />
    </StudioProvider></AccountGate></AppErrorBoundary>
  )
}
