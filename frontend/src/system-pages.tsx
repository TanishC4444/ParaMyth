import { Component, type ErrorInfo, type ReactNode } from "react"
import { Emblem, Wordmark } from "./brand"
import { REPOSITORY, STATIC_SITE } from "./site"
import "./night.css"
import "./system-pages.css"

/** Branded stand-in while a page's code or data loads. */
export function PageLoading({ label = "Opening this page…", light = false }: { label?: string; light?: boolean }) {
  return <div className={`pm-loading${light ? " light" : ""}`} role="status" aria-live="polite">
    <span className="pm-loading-mark" aria-hidden="true"><Emblem /></span>
    <span>{label}</span>
  </div>
}

export function RecoveryPage({ message = "The page could not load. Check your connection and try again." }: { message?: string }) {
  return <div className="night-page system-page" role="alert"><header className="pm-bar"><Wordmark /></header><main className="system-page-main"><h1>We couldn’t <em>open this page.</em></h1><p className="system-page-lede">{message}</p><div className="system-page-actions"><button className="pm-plate" onClick={() => location.reload()}>Try Again</button><a className="pm-plate ghost" href="/">Back to ParaMyth</a><a className="system-page-link" href={`${REPOSITORY}/issues`} target="_blank" rel="noreferrer">Get Support ↗</a></div></main></div>;
}

/** Shown for "#/..." routes that do not exist. */
export function NotFound() {
  const route = location.hash.replace(/^#\/?/, "")
  return <div className="night-page system-page">
    <header className="pm-bar"><Wordmark /></header>
    <main className="system-page-main" id="system-main" tabIndex={-1}>
      <p className="pm-kicker"><span>404 · Page not found</span></p>
      <h1>Page <em>not found.</em></h1>
      <p className="system-page-lede">
        There is no page at <code>#/{route}</code>. It may have moved, or the link may be mistyped.
      </p>
      <div className="system-page-actions">
        <a className="pm-plate" href="#/">Back to ParaMyth <span aria-hidden="true">→</span></a>
        <a className="pm-plate ghost" href="#/atlas">Open the story atlas</a>
        {!STATIC_SITE && <a className="pm-plate ghost" href="#/overview">Go to your studio</a>}
      </div>
    </main>
  </div>
}

// Browsers word a missing lazy chunk differently; all of these follow a redeploy.
const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|error loading dynamically imported|Loading chunk|ChunkLoadError/i
const RELOAD_KEY = "paramyth-chunk-reload"

type BoundaryState = { error: Error | null }

/** Catches render and lazy-load failures so a broken page never leaves a blank screen. */
export class AppErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, BoundaryState> {
  state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  // Navigating elsewhere clears the error without remounting healthy cached pages.
  componentDidUpdate(previous: { resetKey?: string }) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ParaMyth page error", error, info.componentStack)
    if (!CHUNK_ERROR.test(String(error?.message))) return
    // A new deploy replaced this tab's code. Reload once to fetch it; never loop.
    try {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
      if (Date.now() - last > 30_000) {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
        location.reload()
      }
    } catch { /* storage blocked: show the recovery page instead */ }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const stale = CHUNK_ERROR.test(String(error.message))
    return <div className="night-page system-page" role="alert">
      <header className="pm-bar"><Wordmark /></header>
      <main className="system-page-main">
        <p className="pm-kicker"><span>{stale ? "A newer version is available" : "Something went wrong"}</span></p>
        <h1>{stale ? <>A site update <em>is ready.</em></> : <>This page <em>couldn’t load.</em></>}</h1>
        <p className="system-page-lede">
          {stale
            ? "ParaMyth was updated while this page was open. Reload to get the latest version."
            : "Part of this page failed to load. Reload to try again, or return to ParaMyth."}
        </p>
        <div className="system-page-actions">
          <button className="pm-plate" onClick={() => location.reload()}>Reload <span aria-hidden="true">↻</span></button>
          <a className="pm-plate ghost" href="#/" onClick={() => this.setState({ error: null })}>Back to ParaMyth</a>
          <a className="system-page-link" href={`${REPOSITORY}/issues`} target="_blank" rel="noreferrer">Report this problem ↗</a>
        </div>
      </main>
    </div>
  }
}
