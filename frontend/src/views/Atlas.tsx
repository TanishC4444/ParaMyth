import {
  lazy,
  Suspense,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import {
  ink,
  label,
  loadAtlas,
  loadStory,
  matches,
  seedFor,
  type AtlasOrigin,
} from "../atlas"

import "../atlas.css"

import { api } from "../api"

import { uid } from "../data"

import { useStudio } from "../store"

import type {
  AtlasApproach,
  AtlasEpisode,
  AtlasIndex,
  AtlasStory,
  Pin,
} from "../types"

import { Icon, PageTitle } from "../ui"

import { StoryArtwork } from "../art"

import AtlasGlobe from "./AtlasGlobe"

const AtlasMap = lazy(() => import("./AtlasMap"))

const LIST_LIMIT = 80

export default function Atlas({ landing = false }: { landing?: boolean }) {
  const { store, setStore, project, ideate, notify, atlasQuery } = useStudio()

  const [data, setData] = useState<{
      index: AtlasIndex
      origin: AtlasOrigin
    } | null>(null),
    [error, setError] = useState("")

  const [q, setQ] = useState(""),
    [hidden, setHidden] = useState<Set<string>>(new Set()),
    [detailedOnly, setDetailedOnly] = useState(false)

  const [story, setStory] = useState<AtlasStory | null>(null),
    [loading, setLoading] = useState(""),
    [inView, setInView] = useState<string[]>([])

  const [idea, setIdea] = useState(atlasQuery),
    [retrieved, setRetrieved] = useState<any[]>([]),
    [searchMode, setSearchMode] = useState("lexical"),
    [searchingIdea, setSearchingIdea] = useState(false),
    [searchError, setSearchError] = useState(""),
    [retrievalInfo, setRetrievalInfo] = useState("")

  const [focus, setFocus] = useState<{ id: string; at: number } | null>(null)

  const [legend, setLegend] = useState(() => window.innerWidth > 760)

  const [mode, setMode] = useState<"globe" | "map">("globe")

  const [cluster, setCluster] = useState<string[] | null>(null)

  const [limit, setLimit] = useState(LIST_LIMIT)

  const request = useRef(0)

  const side = useRef<HTMLElement>(null)

  useEffect(
    () => () => {
      request.current++
    },
    [],
  )

  useEffect(() => {
    setLimit(LIST_LIMIT)
    setCluster(null)
  }, [q, hidden, detailedOnly, mode])

  useEffect(() => {
    let active = true
    loadAtlas()
      .then((value) => {
        if (active) {
          setData(value)
          setError("")
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Unavailable")
      })
    return () => {
      active = false
    }
  }, [])

  const all = data?.index.stories ?? []

  const visible = useMemo(
    () =>
      all.filter(
        (s) =>
          !hidden.has(s.region) &&
          (!detailedOnly || s.detailed) &&
          matches(s, q),
      ),
    [all, hidden, detailedOnly, q],
  )

  const counts = useMemo(
    () =>
      all.reduce(
        (m, s) => m.set(s.region, (m.get(s.region) || 0) + 1),
        new Map<string, number>(),
      ),
    [all],
  )

  // A search lists every match, wherever it is; otherwise the list follows the map.

  const searching = q.trim() !== "" && !cluster

  const listed = useMemo(() => {
    const ids = new Set(cluster ?? inView)
    return visible
      .filter((s) => searching || ids.has(s.id))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [visible, inView, searching, cluster])

  const reveal = () => {
    if (window.innerWidth <= 1100)
      side.current?.scrollIntoView({ behavior: "instant", block: "start" })
  }

  const select = async (id: string, fly = false) => {
    if (!data) return

    const current = ++request.current

    if (fly) setFocus({ id, at: Date.now() })

    setLoading(id)

    try {
      const result = await loadStory(id, data.origin)

      if (request.current === current) {
        setStory(result)
        if (side.current) side.current.scrollTop = 0
        reveal()
      }
    } catch {
      if (request.current === current) notify("Couldn't load that story")
    } finally {
      if (request.current === current) setLoading("")
    }
  }

  const findIdeas = async (value = idea) => {
    setSearchingIdea(true)
    setSearchError("")
    try {
      const result = await api("/api/ui/search", {
        query: value,
        mode: searchMode,
      })
      setRetrieved(result.sources)
      if (!result.sources.length)
        setSearchError(
          "No matches yet. Try a theme, conflict, or character choice.",
        )
      setRetrievalInfo(result.mode || searchMode)
      setQ("")
      setHidden(new Set())
      setDetailedOnly(false)
      const first = result.sources.find((r: any) => r.atlas_id)
      if (first) await select(first.atlas_id, true)
    } catch (e) {
      setSearchError(String(e))
    } finally {
      setSearchingIdea(false)
    }
  }

  useEffect(() => {
    if (atlasQuery && data) {
      setIdea(atlasQuery)
      void findIdeas(atlasQuery)
    }
  }, [atlasQuery, !!data])

  const toggleRegion = (r: string) =>
    setHidden((h) => {
      const n = new Set(h)
      if (n.has(r)) n.delete(r)
      else n.add(r)
      return n
    })

  const only = (r: string) =>
    setHidden(new Set(data!.index.regions.filter((x) => x !== r)))

  const start = (s: AtlasStory, approach: AtlasApproach) =>
    ideate(seedFor(s, approach))

  const startEpisode = (
    s: AtlasStory,
    e: AtlasEpisode,
    approach: AtlasApproach,
  ) =>
    ideate(
      seedFor(
        {
          ...s,
          id: e.id,
          title: e.title,
          tradition: s.title,
          mechanism: e.mechanism,
          instruction: e.instruction,
          analysis: e.analysis,
        },
        approach,
      ),
    )

  const pinned =
    story &&
    store.pins.some(
      (p) => p.projectId === project.id && p.recordId === story.id,
    )

  const pin = (s: AtlasStory) => {
    if (!project.id)
      return notify("Create a story project before pinning sources.")

    if (pinned) return notify("Already pinned")

    const p: Pin = {
      id: uid(),
      projectId: project.id,
      recordId: s.id,
      title: s.title,
      scope: "Story",
      purpose: `Atlas · ${label(s.mechanism)}`,
    }

    setStore((st) => ({ ...st, pins: [...st.pins, p] }))

    notify(`Pinned to ${project.title}`)
  }

  const sourceNote = !data
    ? ""
    : data.origin.kind === "api"
      ? "Live from literary_rag.db via the studio API"
      : "Bundled export of literary_rag.db · connect the studio API for live records"

  return (
    <div className={`${landing ? "atlas-landing" : "page"} atlas-page`}>
      <PageTitle
        eyebrow={
          landing
            ? `${all.length || "…"} TALES · ${data?.index.regions.length || "…"} TRADITIONS · ENDLESS BEGINNINGS`
            : "BEGIN WITH A TALE"
        }
        title="A world of stories"
        text="Turn the globe. Open a tale. See where it takes you."
      >
        <div className="atlas-mode" aria-label="Atlas display">
          <button
            aria-pressed={mode === "globe"}
            onClick={() => setMode("globe")}
          >
            3D globe
          </button>
          <button aria-pressed={mode === "map"} onClick={() => setMode("map")}>
            Flat map
          </button>
        </div>
        {data && (
          <span className={`atlas-source ${data.origin.kind}`}>
            <i />
            {data.origin.kind === "api" ? "Studio API" : "Offline export"}
          </span>
        )}
      </PageTitle>

      <div className="atlas-concept">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void findIdeas()
          }}
        >
          <input
            aria-label="Find stories for your idea"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            maxLength={2000}
            placeholder="Describe your idea: a bargain, a journey, a difficult choice…"
          />
          <select
            aria-label="Literary search method"
            value={searchMode}
            onChange={(e) => setSearchMode(e.target.value)}
          >
            <option value="lexical">Story keywords</option>
            <option value="hybrid">Semantic + keywords</option>
          </select>
          <button
            className="primary"
            disabled={!data || !idea.trim() || searchingIdea}
          >
            {searchingIdea ? "Finding stories…" : "Find inspiration"}
          </button>
        </form>
        {searchError && <p role="alert">{searchError}</p>}
        {retrieved.length > 0 && (
          <>
            <p className="hint">
              Matches from literary retrieval · {retrievalInfo}. Select a story
              to travel there.
            </p>
            <div className="atlas-matches">
              {retrieved.map((r: any) => (
                <button
                  key={r.id}
                  disabled={!r.atlas_id}
                  onClick={() => void select(r.atlas_id, true)}
                >
                  <b>{r.title || r.id}</b>
                  <small>
                    {String(
                      r.excerpt ||
                        r.summary ||
                        r.analysis ||
                        r.mechanism ||
                        r.instruction ||
                        "",
                    ).slice(0, 180)}
                  </small>
                  {!r.atlas_id && <small>No geographic anchor recorded</small>}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {error ? (
        <div className="empty">
          <Icon name="alert" />
          <h3>Atlas unavailable</h3>
          <p>{error}. Check the studio connection and retry.</p>
          <button
            className="secondary"
            onClick={() => {
              setError("")
              void loadAtlas()
                .then((value) => {
                  setData(value)
                  setError("")
                })
                .catch((e) => setError(e.message))
            }}
          >
            Retry atlas
          </button>
        </div>
      ) : (
        <div className="atlas-layout">
          <section
            className={`atlas-frame ${mode === "globe" ? "globe-frame" : ""}`}
          >
            {data ? (
              mode === "globe" ? (
                <AtlasGlobe
                  stories={visible}
                  selectedId={story?.id ?? null}
                  focus={focus}
                  onSelect={(id) => select(id)}
                  onView={setInView}
                  onCluster={(ids) => {
                    request.current++
                    setLoading("")
                    setStory(null)
                    setCluster(ids)
                    setLimit(LIST_LIMIT)
                    reveal()
                  }}
                  onFallback={() => setMode("map")}
                />
              ) : (
                <Suspense
                  fallback={
                    <div className="atlas-map loading">Unrolling the map…</div>
                  }
                >
                  <AtlasMap
                    stories={visible}
                    selectedId={story?.id ?? null}
                    focus={focus}
                    onSelect={(id) => select(id)}
                    onView={setInView}
                  />
                </Suspense>
              )
            ) : (
              <div className="atlas-map loading">
                <span>Charting a world of stories…</span>
              </div>
            )}
            <div className="atlas-search">
              <Icon name="search" size={16} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search tales, places, mechanisms"
                aria-label="Search the atlas"
              />
              {q && (
                <button aria-label="Clear search" onClick={() => setQ("")}>
                  <Icon name="close" size={14} />
                </button>
              )}
              <small>
                {visible.length} of {all.length}
              </small>
            </div>
            {data && (
              <div
                className={`atlas-legend${legend ? " open" : ""}`}
                aria-label="Traditions"
              >
                <button
                  className="atlas-legend-head"
                  aria-expanded={legend}
                  onClick={() => setLegend(!legend)}
                >
                  <span className="eyebrow">TRADITIONS</span>
                  <small>
                    {hidden.size
                      ? `${data.index.regions.length - hidden.size} of ${data.index.regions.length}`
                      : "All"}
                  </small>
                  <Icon name={legend ? "close" : "plus"} size={12} />
                </button>
                {legend &&
                  data.index.regions.map((r) => (
                    <button
                      key={r}
                      className={hidden.has(r) ? "off" : ""}
                      aria-pressed={!hidden.has(r)}
                      onClick={() => toggleRegion(r)}
                      onDoubleClick={() => only(r)}
                      title="Click to toggle · double-click to show only this"
                    >
                      <i style={{ background: ink(r) }} />
                      {r}
                      <small>{counts.get(r)}</small>
                    </button>
                  ))}
                {legend && (
                  <label className="atlas-check">
                    <input
                      type="checkbox"
                      checked={detailedOnly}
                      onChange={(e) => setDetailedOnly(e.target.checked)}
                    />
                    Full story records only
                  </label>
                )}
                {legend && hidden.size > 0 && (
                  <button className="link" onClick={() => setHidden(new Set())}>
                    Show all
                  </button>
                )}
              </div>
            )}
          </section>

          <aside
            ref={side}
            className="panel atlas-side"
            aria-live="polite"
            aria-busy={!!loading}
          >
            {loading && (
              <p role="status" className="hint">
                Opening story…
              </p>
            )}
            {story ? (
              <StoryDetail
                story={story}
                pinned={!!pinned}
                projectTitle={project.title}
                onBack={() => {
                  request.current++
                  setLoading("")
                  setStory(null)
                }}
                onStart={start}
                onEpisode={startEpisode}
                onPin={pin}
                onFocus={() => {
                  setFocus({ id: story.id, at: Date.now() })
                  if (window.innerWidth <= 1100)
                    side.current?.previousElementSibling?.scrollIntoView({
                      behavior: "instant",
                    })
                }}
              />
            ) : (
              <>
                <span className="eyebrow">
                  {searching
                    ? "SEARCH RESULTS"
                    : cluster
                      ? "SELECTED STORIES"
                      : "IN THIS VIEW"}
                </span>
                <h2>
                  {listed.length}{" "}
                  {searching
                    ? listed.length === 1
                      ? "match"
                      : "matches"
                    : listed.length === 1
                      ? "story"
                      : "stories"}
                </h2>
                <p className="hint">
                  {mode === "globe"
                    ? "Drag to turn the globe; use + and − to zoom. Select a numbered ring to browse its tales, or a title to open a story."
                    : "Pan and zoom to explore; numbered rings gather nearby tales and show their traditions. Select a pin or a title to open its record."}
                </p>
                {cluster && (
                  <button className="link" onClick={() => setCluster(null)}>
                    All stories in view
                  </button>
                )}
                <div className="atlas-list">
                  {listed.slice(0, limit).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => select(s.id, true)}
                      disabled={loading === s.id}
                    >
                      <i style={{ background: ink(s.region) }} />
                      <span>
                        <b>{s.title}</b>
                        <small>
                          {s.tradition} · {s.place}
                        </small>
                      </span>
                    </button>
                  ))}
                  {listed.length > limit && (
                    <button
                      className="link"
                      onClick={() => setLimit(limit + LIST_LIMIT)}
                    >
                      Show more stories ({listed.length - limit} remaining)
                    </button>
                  )}
                  {data && !listed.length && (
                    <p className="quiet">
                      No stories here with the current filters.
                    </p>
                  )}
                </div>
              </>
            )}
            {data && (
              <p className="atlas-provenance">
                {sourceNote}. {data.index.corpus}: model-authored analysis
                drafts; pins mark traditional settings or where a tale was told,
                collected or composed.
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}

function StoryDetail({
  story: s,
  pinned,
  projectTitle,
  onBack,
  onStart,
  onEpisode,
  onPin,
  onFocus,
}: {
  story: AtlasStory
  pinned: boolean
  projectTitle: string
  onBack: () => void
  onFocus: () => void

  onStart: (s: AtlasStory, a: AtlasApproach) => void
  onEpisode: (s: AtlasStory, e: AtlasEpisode, a: AtlasApproach) => void
  onPin: (s: AtlasStory) => void
}) {
  return (
    <article className="atlas-detail">
      <button className="link atlas-back" onClick={onBack}>
        <Icon name="arrow" size={14} />
        All stories in view
      </button>
      <span className="eyebrow" style={{ color: ink(s.region) }}>
        {s.region.toUpperCase()}
      </span>
      <h2>{s.title}</h2>
      <button className="atlas-place" onClick={onFocus} title="Show on map">
        <Icon name="pin" size={14} />
        {s.place}
        <em>
          {s.basis === "setting" ? "where it is set" : "where it was told"}
        </em>
      </button>
      <p className="atlas-attr">
        <b>{s.tradition}</b> · {s.attribution}
      </p>
      <StoryArtwork title={s.title} />

      <p className="atlas-summary">{s.summary || s.analysis}</p>
      <div className="atlas-engine">
        <span className="eyebrow">STORY ENGINE</span>
        <b>{label(s.mechanism)}</b>
        <p>{s.instruction}</p>
      </div>

      <div className="atlas-actions">
        <button className="primary" onClick={() => onStart(s, "Retelling")}>
          <Icon name="sparkle" size={15} />
          Ideate on this story
        </button>
        <button className="secondary" onClick={() => onStart(s, "Inspired by")}>
          <Icon name="ideas" size={15} />
          Draw inspiration
        </button>
        <button
          className="text-action"
          onClick={() => onPin(s)}
          disabled={pinned}
        >
          <Icon name={pinned ? "check" : "pin"} size={14} />
          {pinned ? `Pinned to ${projectTitle}` : `Pin to ${projectTitle}`}
        </button>
      </div>
      <p className="hint">
        Ideate keeps the source and asks whose version this is; inspiration
        carries only its engine into an original premise.
      </p>

      {s.summary && (
        <Section title="Why it works">
          <p>{s.analysis}</p>
        </Section>
      )}
      {s.context && (
        <Section title="World">
          <p>{s.context}</p>
        </Section>
      )}
      {!!s.characters.length && (
        <Section title="Characters">
          <ul>
            {s.characters.map((c) => {
              const [n, ...d] = c.split(":")
              return (
                <li key={c}>
                  <b>{n}</b>
                  {d.length ? `:${d.join(":")}` : ""}
                </li>
              )
            })}
          </ul>
        </Section>
      )}
      {!!s.key_ideas.length && (
        <Section title="Key ideas">
          <ul>
            {s.key_ideas.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </Section>
      )}
      {s.tone && (
        <Section title="Tone">
          <p>{s.tone}</p>
        </Section>
      )}
      {!!s.threads.length && (
        <Section title="Subplots">
          <ul>
            {s.threads.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Section>
      )}
      {!!s.sensory.length && (
        <Section title="Sensory detail">
          <ul>
            {s.sensory.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Section>
      )}
      {s.adaptability && (
        <Section title="Adaptability">
          <p>{s.adaptability}</p>
        </Section>
      )}
      {!!s.children.length && (
        <Section title={`Episodes · ${s.children.length}`}>
          {s.children.map((e) => (
            <div className="atlas-episode" key={e.id}>
              <b>{e.title}</b>
              <p>{e.analysis}</p>
              <div className="comment-actions">
                <button onClick={() => onEpisode(s, e, "Retelling")}>
                  Ideate
                </button>
                <button onClick={() => onEpisode(s, e, "Inspired by")}>
                  Draw inspiration
                </button>
                <small>{label(e.mechanism)}</small>
              </div>
            </div>
          ))}
        </Section>
      )}
      <div className="tag-row">
        {s.genre.map((g) => (
          <em key={g}>{g}</em>
        ))}
        {s.themes.map((t) => (
          <span key={t}>{label(t)}</span>
        ))}
        {s.techniques.map((t) => (
          <span key={t}>{label(t)}</span>
        ))}
      </div>
      {(s.version_notes || s.notes.length > 0) && (
        <p className="hint">
          {[s.version_notes, ...s.notes].filter(Boolean).join(" ")}
        </p>
      )}
      <p className="hint">
        <code>{s.id}</code> · {label(s.verification)}
      </p>
    </article>
  )
}

const Section = ({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) => (
  <section className="atlas-section">
    <h3>{title}</h3>
    {children}
  </section>
)
