import {
  lazy,
  Suspense,
  type ReactNode,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react"

import {
  ink,
  label,
  loadAtlas,
  bundledAtlas,
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

import AtlasGlobe, { type GlobeTransition } from "./AtlasGlobe"

const AtlasMap = lazy(() => import("./AtlasMap"))

const LIST_LIMIT = 8

export default function Atlas({ landing = false, reduceMotion = false, onReady }: { landing?: boolean; reduceMotion?: boolean; onReady?: () => void }) {
  const { store, setStore, project, ideate, notify, atlasQuery } = useStudio()

  const [data, setData] = useState<{
      index: AtlasIndex
      origin: AtlasOrigin
    }>(bundledAtlas)

  const [q, setQ] = useState(""),
    [hidden, setHidden] = useState<Set<string>>(new Set()),
    [detailedOnly, setDetailedOnly] = useState(false)

  const [story, setStory] = useState<AtlasStory | null>(null),
    [loading, setLoading] = useState(""),
    [globeView, setGlobeView] = useState<string[]>([])

  const [idea, setIdea] = useState(atlasQuery),
    [retrieved, setRetrieved] = useState<any[]>([]),
    [searchMode, setSearchMode] = useState("hybrid"),
    [matchCount, setMatchCount] = useState(8),
    [matchingOnly, setMatchingOnly] = useState(true),
    [searchingIdea, setSearchingIdea] = useState(false),
    [searchError, setSearchError] = useState(""),
    [retrievalInfo, setRetrievalInfo] = useState(""),
    [rankingWarning, setRankingWarning] = useState("")

  const [focus, setFocus] = useState<{ id: string; at: number } | null>(null)

  const [legend, setLegend] = useState(false)

  const [requestedMode, requestMode] = useState<"globe" | "map">("globe")
  const [mapReady, setMapReady] = useState(false)
  const [mapView, setMapView] = useState<string[]>([])
  const markMapReady = useCallback(() => setMapReady(true), [])
  const [mode, setMode] = useState<"globe" | "map">("globe")
  const [zooming, setZooming] = useState(false)
  const globeTransition = useRef<GlobeTransition>(null)
  const [mapFocus, setMapFocus] = useState<{ lat: number; lng: number; at: number }>()
  const mapCenter = useRef<{ lat: number; lng: number } | null>(null)
  const rememberMapCenter = useCallback((center: { lat: number; lng: number }) => { mapCenter.current = center }, [])
  useEffect(() => {
    const reduced = reduceMotion || matchMedia("(prefers-reduced-motion: reduce)").matches
    let handoff: ReturnType<typeof setTimeout> | undefined
    if (requestedMode === "map" && mapReady) {
      const center = globeTransition.current?.zoomToMap()
      if (center) setMapFocus({ ...center, at: Date.now() })
      setZooming(!reduced)
      if (reduced) setMode("map")
      else handoff = setTimeout(() => { setMode("map"); setZooming(false) }, 720)
    } else if (requestedMode === "globe") {
      globeTransition.current?.pullOut(mode === "map" ? mapCenter.current : null)
      setMode("globe"); setZooming(false)
    }
    return () => clearTimeout(handoff)
  }, [requestedMode, mapReady, reduceMotion])
  const inView = mode === "map" ? mapView : globeView

  const [cluster, setCluster] = useState<string[] | null>(null)

  const [limit, setLimit] = useState(LIST_LIMIT)

  const request = useRef(0)
  const searchRequest = useRef(0)
  const modeChosen = useRef(false)

  useEffect(() => {
    let active = true
    api("/api/ui/retrieval-connection").then((r) => {
      if (active && !modeChosen.current) setSearchMode(r.semantic ? "hybrid" : "lexical")
    }).catch(() => {})
    return () => { active = false; searchRequest.current++ }
  }, [])

  const side = useRef<HTMLElement>(null)

  useEffect(
    () => () => {
      request.current++
    },
    [],
  )

  useEffect(() => {
    request.current++
    setLoading("")
    setStory(null)
    setLimit(LIST_LIMIT)
    setCluster(null)
  }, [q, hidden, detailedOnly])

  useEffect(() => {
    let active = true
    loadAtlas()
      .then((value) => {
        if (active) {
          setData(value)
        }
      })
      .catch(() => { /* The bundled atlas stays visible if live refresh fails. */ })
    return () => {
      active = false
    }
  }, [])

  const all = data?.index.stories ?? []

  const matchedIds = useMemo(() => new Set(retrieved.map((r) => r.atlas_id).filter(Boolean)), [retrieved])

  const visible = useMemo(
    () =>
      all.filter(
        (s) =>
          (!matchingOnly || !matchedIds.size || matchedIds.has(s.id)) &&
          !hidden.has(s.region) &&
          (!detailedOnly || s.detailed) &&
          matches(s, q),
      ),
    [all, hidden, detailedOnly, q, matchedIds, matchingOnly],
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
      side.current?.scrollIntoView({ behavior: reduceMotion || matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" })
  }

  useEffect(() => { if (story || cluster) reveal() }, [story?.id, cluster])

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
      }
    } catch {
      if (request.current === current) notify("Couldn't load that story")
    } finally {
      if (request.current === current) setLoading("")
    }
  }

  const findIdeas = async (value = idea) => {
    const current = ++searchRequest.current
    request.current++
    setRetrieved([])
    setStory(null)
    setCluster(null)
    setLoading("")
    setSearchingIdea(true)
    setSearchError("")
    setRankingWarning("")
    try {
      const result = await api("/api/ui/search", {
        query: value,
        mode: searchMode,
        limit: matchCount,
      })
      if (current !== searchRequest.current) return
      setRetrieved(result.sources)
      setRankingWarning(result.ranking_warning || "")
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
      if (current === searchRequest.current) setSearchError(e instanceof Error && e.name === "TimeoutError" ? "Search is taking too long. Try again in a moment, or choose Story keywords." : String(e))
    } finally {
      if (current === searchRequest.current) setSearchingIdea(false)
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

  return (
    <div className={`${landing ? "atlas-landing" : "page"} atlas-page`}>
      <PageTitle
        eyebrow={
          landing
            ? "EXPLORE THE WORLD"
            : "BEGIN WITH A TALE"
        }
        title="Story Atlas"
        text=""
      >
        <div className="atlas-mode" aria-label="Atlas display">
          <button
            aria-pressed={requestedMode === "globe"}
            onClick={() => { requestMode("globe") }}
          >
            3D Globe
          </button>
          <button aria-pressed={requestedMode === "map"} onClick={() => { requestMode("map") }}>
            Flat Map
          </button>
        </div>
        {data && (
          <span className={`atlas-source ${data.origin.kind}`}>
            <i />
            {data.origin.kind === "api" ? "Live corpus" : "Saved corpus"}
          </span>
        )}
      </PageTitle>


        <div className={`atlas-layout${story ? " has-story" : ""}`}>
          <section
            className="atlas-frame globe-frame"
          >
            <div className={`atlas-scene${zooming ? " zooming-in" : ""}`} data-mode={mode} aria-busy={zooming || (requestedMode === "map" && !mapReady)}>
              <div className={`atlas-layer globe-layer${mode === "globe" ? " active" : ""}`} inert={mode !== "globe"} aria-hidden={mode !== "globe"}>
                <AtlasGlobe
                  transitionRef={globeTransition}
                  reduceMotion={reduceMotion}
                  onReady={onReady}
                  stories={visible}
                  selectedId={story?.id ?? null}
                  focus={focus}
                  onSelect={(id) => select(id)}
                  onView={setGlobeView}
                  onCluster={(ids) => {
                    request.current++
                    setLoading("")
                    setStory(null)
                    setCluster(ids)
                    setLimit(LIST_LIMIT)
                  }}
                  onFallback={() => requestMode("map")}
                />
              </div>
              <div className={`atlas-layer map-layer${mode === "map" ? " active" : ""}`} inert={mode !== "map"} aria-hidden={mode !== "map"}>
                <Suspense fallback={null}>
                  <AtlasMap
                    stories={visible}
                    selectedId={story?.id ?? null}
                    focus={focus}
                    onSelect={(id) => select(id)}
                    onView={setMapView}
                    onReady={markMapReady}
                    view={mapFocus}
                    onCenter={rememberMapCenter}
                    reduceMotion={reduceMotion}
                  />
                </Suspense>
              </div>
              {requestedMode === "map" && !mapReady && <span className="atlas-view-loading" role="status">Preparing map…</span>}
            </div>
            <div className="atlas-search">
              <Icon name="search" size={16} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find a story or place"
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
                  <span className="eyebrow">Traditions</span>
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
                canPin={!!project.id}
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
                    ? "Search Results"
                    : cluster
                      ? "Selected Stories"
                      : "In This View"}
                </span>
                <h2>
                  {listed.length}{" "}
                  {searching
                    ? listed.length === 1
                      ? "Match"
                      : "Matches"
                    : listed.length === 1
                      ? "Story"
                      : "Stories"}
                </h2>
                <p className="hint">
                  {mode === "globe"
                    ? "Select a marker or a story."
                    : "Select a marker or a story."}
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
                          {s.region} · {s.place}
                        </small>
                      </span>
                    </button>
                  ))}
                  {listed.length > limit && (
                    <button
                      className="link"
                      onClick={() => setLimit(limit + LIST_LIMIT)}
                    >
                      More Stories ({listed.length - limit} remaining)
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
            {data && <details className="atlas-provenance"><summary>About These Stories</summary><p>Traditional tales with draft literary analysis. Locations mark a story’s setting or where it was told, collected, or composed.</p><p>{data.origin.kind === "api" ? "Live collection" : "Saved collection"} · {all.length} stories</p></details>}
          </aside>
        </div>
      <details className="atlas-concept atlas-idea-tools"><summary>Search by Idea <span aria-hidden="true">↗</span></summary>
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
            onChange={(e) => { modeChosen.current = true; setSearchMode(e.target.value) }}
          >
            <option value="lexical">Story keywords</option>
            <option value="hybrid">Semantic + keywords</option>
          </select>
          <select aria-label="Number of story matches" value={matchCount} onChange={(e) => setMatchCount(Number(e.target.value))}>
            <option value={6}>Up to 6 stories</option><option value={8}>Up to 8 stories</option><option value={12}>Up to 12 stories</option>
          </select>
          <button
            className="primary"
            disabled={!data || !idea.trim() || searchingIdea}
          >
            {searchingIdea ? "Finding stories…" : "Find inspiration"}
          </button>
        </form>
        {searchError && <p role="alert">{searchError}</p>}
        {rankingWarning && <p role="status">{rankingWarning}</p>}
        {retrieved.length > 0 && (
          <>
            <p className="hint">
              {retrieved.length} {retrieved.length === 1 ? "story match" : "related stories"} · {retrievalInfo === "hybrid" ? "Meaning + keywords" : "Story keywords"}. Choose any match to turn the globe and explore it.
            </p>
            <div className="atlas-match-controls">
              <label><input type="checkbox" checked={matchingOnly} onChange={(e) => setMatchingOnly(e.target.checked)} /> Show matches on the globe</label>
              <button className="text-action" onClick={() => { setRetrieved([]); setSearchError(""); setRankingWarning(""); setStory(null); setCluster(null) }}>Clear matches</button>
            </div>
            <div className="atlas-matches">
              {retrieved.map((r: any, index: number) => (
                <button
                  key={r.id}
                  aria-pressed={story?.id === r.atlas_id}
                  disabled={!r.atlas_id}
                  onClick={() => void select(r.atlas_id, true)}
                >
                  <span className="match-rank">{String(index + 1).padStart(2, "0")}</span>
                  <b>{r.title || r.id}</b>
                  {r.match_kind && <span className="match-kind">{r.match_kind === "direct" ? "Close match" : "Related idea"}</span>}
                  <small>
                    {String(
                      r.match_reason ||
                        r.excerpt ||
                        r.summary ||
                        r.analysis ||
                        r.mechanism ||
                        r.instruction ||
                        "",
                    ).slice(0, 300)}
                  </small>
                  {!r.atlas_id && <small>No geographic anchor recorded</small>}
                </button>
              ))}
            </div>
          </>
        )}
      </details>
    </div>
  )
}

function StoryDetail({
  story: s,
  pinned,
  projectTitle,
  canPin,
  onBack,
  onStart,
  onEpisode,
  onPin,
  onFocus,
}: {
  story: AtlasStory
  pinned: boolean
  projectTitle: string
  canPin: boolean
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
        Back to Stories
      </button>
      <span className="eyebrow" style={{ color: ink(s.region) }}>
        {s.region}
      </span>
      <h2>{s.title}</h2>
      <button className="atlas-place" onClick={onFocus} title="Show on map">
        <Icon name="pin" size={14} />
        {s.place}
        <em>
          {s.basis === "setting" ? "Story Setting" : "Collection Site"}
        </em>
      </button>
      <p className="atlas-attr">
        {s.attribution}
      </p>
      <StoryArtwork title={s.title} />

      <StorySummary key={s.id} text={s.summary || s.analysis} />
      <div className="atlas-engine">
        <span className="eyebrow">The story pattern</span>
        <b>{label(s.mechanism)}</b>
        <p>{s.instruction}</p>
      </div>

      <div className="atlas-actions">
        <button className="primary" onClick={() => onStart(s, "Retelling")}>
          <Icon name="sparkle" size={15} />
          Retell This Story
        </button>
        <button className="secondary" onClick={() => onStart(s, "Inspired by")}>
          <Icon name="ideas" size={15} />
          Make It Your Own
        </button>
        {canPin && <button
          className="text-action"
          onClick={() => onPin(s)}
          disabled={pinned}
        >
          <Icon name={pinned ? "check" : "pin"} size={14} />
          {pinned ? `Pinned to ${projectTitle}` : `Pin to ${projectTitle}`}
        </button>}
      </div>
      <p className="hint">
        Start a new project with this tale or its central idea.
      </p>

      <details className="atlas-record-extra"><summary>Explore This Story</summary>
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
                  Make It Your Own
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
      </details>
    </article>
  )
}

function StorySummary({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const long = text.length > 440
  const preview = long ? text.slice(0, 420).replace(/\s+\S*$/, "") + "…" : text
  return <div className="story-synopsis"><p className="atlas-summary">{expanded ? text : preview}</p>{long && <button className="link" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show Less" : "Read Full Synopsis"}</button>}</div>
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
