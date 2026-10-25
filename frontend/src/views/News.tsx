import { useEffect, useState } from "react"
import { api } from "../api"
import { ago, fmtTime, Icon, PageTitle } from "../ui"

type Headline = { title: string; link: string; source: string; source_id: string; published: string | null; summary: string }
type Source = { id: string; name: string; site: string; ok: boolean; error: string | null; count: number; updated: string | null }
type Feed = { items: Headline[]; sources: Source[]; checked: string; cache_seconds: number }

/** The news route lives on the local studio. Without it (a static build, or the server is off) say so instead of erroring. */
async function studioRunning() {
  try {
    const r = await fetch("/api/v1/health", { cache: "no-store" })
    return r.ok && (r.headers.get("content-type") || "").includes("json")
  } catch {
    return false
  }
}

const names = (sources: Source[]) =>
  sources.length < 3 ? sources.map((s) => s.name).join(" and ") : `${sources.slice(0, -1).map((s) => s.name).join(", ")} and ${sources.at(-1)!.name}`

export default function News() {
  const [feed, setFeed] = useState<Feed | null>(null),
    [source, setSource] = useState("all"),
    [q, setQ] = useState(""),
    [busy, setBusy] = useState(true),
    [offline, setOffline] = useState(false),
    [error, setError] = useState("")

  const load = async (refresh = false) => {
    setBusy(true)
    setError("")
    try {
      setFeed(await api<Feed>(refresh ? "/api/ui/news/refresh" : "/api/ui/news", refresh ? {} : undefined))
      setOffline(false)
    } catch (e: any) {
      if (await studioRunning()) setError(e.message)
      else setOffline(true)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    load()
  }, [])

  const down = feed?.sources.filter((s) => !s.ok) || []
  const query = q.trim().toLowerCase()
  const shown = (feed?.items || []).filter(
    (i) => (source === "all" || i.source_id === source) && (!query || `${i.title} ${i.summary}`.toLowerCase().includes(query)),
  )

  return (
    <div className="page news-page">
      <PageTitle
        eyebrow="INDUSTRY NEWS"
        title="Film and TV news"
        text="Headlines on film, TV and screenwriting from trade and craft sites. Each one opens the original article, and the list updates about every 15 minutes."
      >
        <button className="secondary" onClick={() => load(true)} disabled={busy || offline}>
          <Icon name="refresh" size={16} />
          {busy && feed ? "Refreshing…" : "Refresh news"}
        </button>
      </PageTitle>
      {offline ? (
        <div className="empty">
          <Icon name="news" size={30} />
          <h3>News needs the local studio</h3>
          <p>
            Start it with <code>paramyth-studio</code>, then open this page from it to load headlines.
          </p>
        </div>
      ) : !feed ? (
        error ? (
          <p className="live-status error" role="alert">
            {error}
          </p>
        ) : (
          <p className="live-loading" role="status">
            Loading headlines…
          </p>
        )
      ) : (
        <>
          {error && (
            <p className="live-status error" role="alert">
              {error}
            </p>
          )}
          {down.length > 0 && down.length < feed.sources.length && (
            <p className="live-status error" role="status">
              Couldn't reach {names(down)} just now. Showing everything else we could load.
            </p>
          )}
          <div className="toolbar">
            <label>
              <Icon name="search" size={16} />
              <input aria-label="Find a headline" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a headline" />
            </label>
            <select aria-label="Filter by source" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="all">All sources</option>
              {feed.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({feed.items.filter((i) => i.source_id === s.id).length}){s.ok ? "" : " · unavailable"}
                </option>
              ))}
            </select>
          </div>
          <p className="hint news-meta">
            {shown.length} headlines · updated {ago(feed.checked)}
          </p>
          {shown.length ? (
            <div className="review-list news-list">
              {shown.map((i) => (
                <article className="news-item" key={i.link}>
                  <span className="kind">{i.source}</span>
                  <div>
                    <h3>
                      <a href={i.link} target="_blank" rel="noopener noreferrer">
                        {i.title}
                      </a>
                    </h3>
                    {i.summary && <p>{i.summary}</p>}
                    <small>
                      {i.published && <time dateTime={i.published}>{fmtTime(i.published)}</time>}
                      <a href={i.link} target="_blank" rel="noopener noreferrer" aria-label={`Read "${i.title}" on ${i.source}`}>
                        Read on {i.source} <Icon name="arrow" size={13} />
                      </a>
                    </small>
                  </div>
                </article>
              ))}
            </div>
          ) : down.length === feed.sources.length ? (
            <div className="empty">
              <Icon name="alert" size={30} />
              <h3>Couldn't load the news</h3>
              <p>None of the sources responded. Check your internet connection, then refresh.</p>
            </div>
          ) : feed.items.length ? (
            <div className="empty">
              <Icon name="search" size={30} />
              <h3>No headlines match</h3>
              <p>Try another source or clear the search.</p>
            </div>
          ) : (
            <div className="empty">
              <Icon name="news" size={30} />
              <h3>No headlines yet</h3>
              <p>The sources haven't posted anything we can show. Refresh in a few minutes.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
