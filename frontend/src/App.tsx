import { lazy, type ReactElement, Suspense, useEffect, useRef, useState } from "react"

import { StudioProvider, useStudio } from "./store"
import AccountGate, { useAccess } from './AccountGate'
import { WorkspacePicker, SharedConflicts } from './TeamWorkspace'

import type { View } from "./types"

import { EmptyState, Icon, PageTitle } from "./ui"
import { BrandLogo } from "./brand"

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
const Discovery = lazy(() => import('./views/Discovery'))
const Tutorials = lazy(() => import('./views/Tutorials'))

const TITLES: Partial<Record<View, string>> = {
  atlas: "Story atlas",
  overview: "Overview",
  projects: "Projects",
  workflow: "Project workspace",
  runs: "Activity",
  retrieval: "Story atlas",
  library: "Project files",
  news: "Industry news",
  connections: "Connections",
  notfound: "Page not found",
  discovery: "Discovery",
  tutorials: "Tutorials",
}

const NAV: { group: string; items: [View, string, string][] }[] = [
  { group: "Workspace", items: [["overview", "overview", "Overview"], ["projects", "projects", "Projects"], ["workflow", "pen", "Project workspace"]] },
  { group: "Discover", items: [["discovery", "message", "Discovery"], ["retrieval", "atlas", "Story atlas"], ["news", "news", "Industry news"]] },
  { group: "Manage", items: [["runs", "runs", "Activity"], ["library", "library", "Project files"], ["connections", "connections", "Connections"]] },
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
  const sidebar = useRef<HTMLElement>(null)
  const menu = useRef<HTMLButtonElement>(null)
  const content = useRef<HTMLElement>(null)
  useEffect(() => { setMobile(false) }, [view])
  useEffect(() => {
    const screen = matchMedia("(min-width: 1025px)")
    const close = () => { if (screen.matches) setMobile(false) }
    screen.addEventListener("change", close)
    return () => screen.removeEventListener("change", close)
  }, [])
  useEffect(() => {
    if (!mobile) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const focusable = () => [...(sidebar.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],select:not(:disabled)') || [])].filter(element => element.getClientRects().length)
    let focusFrame = 0;
    const firstFrame = requestAnimationFrame(() => { focusFrame = requestAnimationFrame(() => focusable()[0]?.focus()) })
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setMobile(false) }
      if (event.key === "Tab") {
        const items = focusable(), first = items[0], last = items.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener("keydown", key)
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(focusFrame); document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", key); menu.current?.focus() }
  }, [mobile])

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
  const publicTutorial = view === 'tutorials' && (!access.authenticated && access.accounts_required || STATIC_SITE)
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
    discovery: <Discovery />,
    tutorials: <Tutorials />,
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
    {publicTutorial && <AppErrorBoundary resetKey={view}><Suspense fallback={<PageLoading />}><Tutorials standalone /></Suspense></AppErrorBoundary>}
    {STATIC_SITE ? !isLanding && !missing && !legal && !publicTutorial && <AppErrorBoundary resetKey={view}><Suspense fallback={<div className="night-page"><PageLoading /></div>}><StaticStudio /></Suspense></AppErrorBoundary> :
    <div className="app-shell" hidden={isLanding || missing || legal || publicTutorial}>
      <a className="studio-skip" href="#studio-content" onClick={event => { event.preventDefault(); content.current?.focus() }}>Skip to workspace</a>
      <aside ref={sidebar} id="studio-navigation" className={`sidebar ${mobile ? "open" : ""}`} aria-label="Workspace navigation" role={mobile ? "dialog" : undefined} aria-modal={mobile || undefined}>
        <div className="sidebar-brand-row">
          <button className="studio-brand" aria-label="ParaMyth home" onClick={() => go("landing")}><BrandLogo /><span className="studio-badge">Studio</span></button>
          <button className="sidebar-close icon-button" aria-label="Close navigation" onClick={() => setMobile(false)}><Icon name="close" /></button>
        </div>
        <WorkspacePicker />
        <nav aria-label="Primary">
          {NAV.map((g) => (
            <div key={g.group} className="nav-group">
              <span>{g.group}</span>
              {g.items.filter(([id]) => id !== "workflow" || project.id).map(([id, icon, label]) => (
                <button
                  key={id}
                  className={
                    view === id || (id === "projects" && view === "project")
                      ? "active"
                      : ""
                  }
                  aria-current={view === id || (id === "projects" && view === "project") ? "page" : undefined}
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
          {project.id && <button className="current-project" onClick={() => go("workflow")}><span className="current-project-icon"><Icon name="canon" /></span><span><small>Current project</small><b>{project.title}</b><small>{project.brief.medium}</small></span><Icon name="arrow" size={15} /></button>}
          {(!access.teams?.length || access.teams.some(team=>['owner','admin'].includes(team.role))) && <a className="studio-team-link" href="/studio/teams.html"><Icon name="connections" size={17} /><span>Team settings</span><span aria-hidden="true">↗</span></a>}
          <a className="sidebar-help" href="#/contact"><Icon name="message" size={17} />Help & support</a>
          <button className="sidebar-help" aria-current={view==='tutorials'?'page':undefined} onClick={()=>go('tutorials')}><Icon name="ideas" size={17}/>Tutorials</button>
        </div>
      </aside>
      {mobile && (
        <button
          className="scrim"
          aria-label="Close menu"
          onClick={() => setMobile(false)}
        />
      )}
      <main ref={content} id="studio-content" className="studio-content" tabIndex={-1} inert={mobile}>
        <header className="studio-topbar">
          <button ref={menu} className="mobile-menu icon-button" aria-label="Open navigation" aria-expanded={mobile} aria-controls="studio-navigation" onClick={() => setMobile(true)}><Icon name="menu" /></button>
          <div className="workspace-context"><Icon name={access.studio ? "connections" : "projects"} size={18} /><span>{access.studio?.name || "Personal workspace"}</span>{access.studio?.role === "viewer" && <span className="workspace-role">View only</span>}</div>
          <div className="header-actions">
            <span role="status" className={`local-label${saving ? " saving" : ""}${error ? " save-error" : ""}`}><Icon name={error ? "alert" : saving ? "refresh" : "check"} size={14} />{error ? "Changes need attention" : saving ? "Saving changes…" : "All changes saved"}</span>
            <a className="studio-account" href={access.authenticated ? "/studio/account.html" : "#/signin"} aria-label={access.authenticated ? "Manage account and sign out" : "Sign in"}><span className="account-initials" aria-hidden="true">{access.account?.display_name.split(/\s+/).map(part => part[0]).slice(0,2).join("").toUpperCase() || "U"}</span><span>{access.authenticated ? access.account?.display_name || "Account" : "Sign in"}</span><Icon name="chevron" size={14} /></a>
          </div>
        </header>
        <SharedConflicts />
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
            {!["workflow", "projects", "overview", "connections", "retrieval", "news", "library", "runs", "discovery", "tutorials"].includes(
              view,
            ) && <Journey />}
            {!project.id &&
            ["workflow", "project", "images", "music", "production", "library"].includes(
              view,
            ) ? (
              <div className="page"><PageTitle title={TITLES[view] || "Project workspace"} text="" /><EmptyState icon="projects" title="A home for your next story" text="Create a project to keep your writing, visuals, sound and production plans together." action={<button className="primary" onClick={() => go("projects")}><Icon name="plus" size={17} />Create a project</button>} /></div>
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
  const previous=useRef(view)
  useEffect(()=>{
    if(previous.current===view)return
    previous.current=view
    const root=document.getElementById('studio-content')
    const focus=()=>{
      const heading=root?.querySelector<HTMLElement>('.workspace-view:not([hidden]) h1')
      if(!heading || !heading.getClientRects().length)return false
      heading.tabIndex=-1;heading.focus({preventScroll:true});return true
    }
    if(focus())return
    const observer=new MutationObserver(()=>{if(focus())observer.disconnect()})
    if(root)observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']})
    return()=>observer.disconnect()
  },[view])
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
