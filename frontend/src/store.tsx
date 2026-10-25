import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react"
import { api, projectPath, type Job } from "./api"
import { uid, now, modeOf } from "./data"
import type {
  CreativeSeed,
  ModeId,
  Project,
  ProjectTab,
  Store,
  View,
} from "./types"
const VIEWS: View[] = [
  "landing",
  "overview",
  "projects",
  "project",
  "atlas",
  "runs",
  "creative",
  "retrieval",
  "images",
  "music",
  "production",
  "library",
  "connections",
]
const routeView = (): View => {
  const v = location.hash.replace(/^#\/?/, "") as View
  return VIEWS.includes(v) ? v : "landing"
}
export const blankProject = (): Project => ({
  id: "",
  title: "Your new story",
  owner: "You",
  color: "mint",
  updated: now(),
  brief: {
    premise: "",
    medium: "Novel",
    genre: "",
    tone: "",
    pov: "",
    themes: [],
    worldRules: [],
    mustAvoid: [],
    chapters: 1,
    scenesPerChapter: 1,
    wordMin: 600,
    wordMax: 1200,
    lengthMode: "Guided",
    characters: [],
  },
  scenes: [],
  canon: [],
  versions: [],
})
const empty = (): Store => ({
  projects: [],
  runs: [],
  ideas: [],
  creative: [],
  images: [],
  tracks: [],
  pins: [],
})
type Studio = {
  store: Store
  setStore: (fn: (s: Store) => Store) => void
  view: View
  go: (v: View) => void
  tab: ProjectTab
  setTab: (t: ProjectTab) => void
  project: Project
  selectProject: (id: string, t?: ProjectTab) => void
  updateProject: (
    id: string,
    p: Partial<Project> | ((p: Project) => Partial<Project>),
  ) => void
  createProject: (p: Project) => Promise<Project>
  startRun: (id: string, m: ModeId, recovered?: string) => boolean
  runAction: (id: string, a: "cancel" | "recover") => void
  notify: (s: string) => void
  toast: string
  seed: CreativeSeed | null
  ideate: (s: CreativeSeed) => void
  clearSeed: () => void
  refresh: () => Promise<void>
  ready: boolean
  error: string
  jobs: Job[]
  saving: boolean
  flush: () => Promise<void>
  atlasQuery: string
  searchAtlas: (q: string) => void
  workflow: string
  mediaDirection: string
  setMediaDirection: (s: string) => void
}
const Ctx = createContext<Studio>(null!)
export const useStudio = () => useContext(Ctx)
export function StudioProvider({ children }: { children: ReactNode }) {
  const [store, setRaw] = useState<Store>(empty),
    ref = useRef(store),
    [view, setView] = useState<View>(routeView),
    [tab, setTab] = useState<ProjectTab>("brief"),
    [selected, setSelected] = useState(""),
    [toast, setToast] = useState(""),
    [seed, setSeed] = useState<CreativeSeed | null>(null),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [jobs, setJobs] = useState<Job[]>([]),
    [saving, setSaving] = useState(false),
    [atlasQuery, setAtlasQuery] = useState(""),
    [workflow, setWorkflow] = useState(""),
    [mediaDirection, setMediaDirection] = useState("")
  const dirty = useRef(new Map<string, Project>()),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    queue = useRef(Promise.resolve()),
    selection = useRef(""),
    notesDirty = useRef(false)
  const set = (s: Store) => {
    ref.current = s
    setRaw(s)
  }
  const go = (v: View) => {
    setView(v)
    const h = v === "landing" ? "#/" : `#/${v}`
    if (location.hash !== h) location.hash = h
  }
  const notify = (s: string) => {
    setToast(s)
    setTimeout(() => setToast(""), 4500)
  }
  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        setSaving(true)
        try {
          for (const [id, p] of [...dirty.current]) {
            const current = ref.current.projects.find((x) => x.id === id)
            if (!current) continue
            const saved = await api<Project>(
              "/api/ui/projects/" + id,
              { ...p, revision: current.revision },
              "PUT",
            )
            if (dirty.current.get(id) === p) dirty.current.delete(id)
            set({
              ...ref.current,
              projects: ref.current.projects.map((x) =>
                x.id === id
                  ? { ...x, revision: saved.revision, updated: saved.updated }
                  : x,
              ),
            })
          }
          if (notesDirty.current) {
            const snapshot = {
              ideas: ref.current.ideas,
              pins: ref.current.pins,
            }
            notesDirty.current = false
            try {
              await api("/api/ui/notes", snapshot, "PUT")
            } catch (e) {
              notesDirty.current = true
              throw e
            }
          }
          setError("")
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not save")
          throw e
        } finally {
          setSaving(false)
        }
      })
    return queue.current
  }, [])
  const refresh = useCallback(async () => {
    try {
      const value = await api<{
        projects: Project[]
        current: string
        ideas: Store["ideas"]
        pins: Store["pins"]
      }>("/api/ui/workspace")
      set({
        ...ref.current,
        projects: value.projects.map((p) => dirty.current.get(p.id) || p),
        ideas: notesDirty.current ? ref.current.ideas : value.ideas,
        pins: notesDirty.current ? ref.current.pins : value.pins,
      })
      const id =
        selection.current &&
        value.projects.some((p) => p.id === selection.current)
          ? selection.current
          : value.current
      selection.current = id
      setSelected(id)
      setReady(true)
      setError("")
      if (id) {
        const j = await api<{ jobs: Job[] }>(
          projectPath("/api/studio/jobs", id),
        )
        setJobs(j.jobs)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Live studio unavailable")
      setReady(true)
    }
  }, [])
  useEffect(() => {
    void refresh()
    const changed = () => setView(routeView())
    const update = () => void refresh()
    window.addEventListener("hashchange", changed)
    window.addEventListener("studio-refresh", update)
    const interval = setInterval(async () => {
      if (!selection.current || document.hidden) return
      try {
        setJobs(
          (
            await api<{ jobs: Job[] }>(
              projectPath("/api/studio/jobs", selection.current),
            )
          ).jobs,
        )
      } catch {}
    }, 5000)
    return () => {
      clearInterval(interval)
      window.removeEventListener("hashchange", changed)
      window.removeEventListener("studio-refresh", update)
    }
  }, [refresh])
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty.current.size || notesDirty.current) {
        e.preventDefault()
        e.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", before)
    return () => window.removeEventListener("beforeunload", before)
  }, [])
  const setStore = (fn: (s: Store) => Store) => {
    const prev = ref.current
    const next = fn(prev)
    for (const p of next.projects) {
      if (p.id && prev.projects.find((x) => x.id === p.id) !== p)
        dirty.current.set(p.id, p)
    }
    if (prev.ideas !== next.ideas || prev.pins !== next.pins)
      notesDirty.current = true
    set(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void flush().catch(() => {})
    }, 700)
  }
  const selectProject = (id: string, t?: ProjectTab) => {
    void (async () => {
      try {
        await flush()
        await api("/api/studio/project/select", { id })
        selection.current = id
        setSelected(id)
        if (t) setTab(t)
        go("project")
        await refresh()
      } catch (e) {
        notify(String(e))
      }
    })()
  }
  const createProject = async (p: Project) => {
    await flush()
    const result = await api<Project>("/api/ui/projects", { project: p })
    await api("/api/studio/project/select", { id: result.id })
    selection.current = result.id
    setSelected(result.id)
    await refresh()
    return result
  }
  const project =
    store.projects.find((p) => p.id === selected) ||
    store.projects[0] ||
    blankProject()
  const value: Studio = {
    store,
    setStore,
    view,
    go,
    tab,
    setTab,
    project,
    selectProject,
    createProject,
    updateProject: (id, patch) =>
      setStore((s) => ({
        ...s,
        projects: s.projects.map((p) =>
          p.id === id
            ? {
                ...p,
                ...(typeof patch === "function" ? patch(p) : patch),
                updated: now(),
              }
            : p,
        ),
      })),
    startRun: (id, m) => {
      setWorkflow(modeOf(m).workflow)
      go("runs")
      return true
    },
    runAction: () => {
      go("runs")
    },
    notify,
    toast,
    seed,
    ideate: (s) => {
      setSeed(s)
      go("creative")
    },
    clearSeed: () => setSeed(null),
    refresh,
    ready,
    error,
    jobs,
    saving,
    flush,
    atlasQuery,
    searchAtlas: (q) => {
      setAtlasQuery(q)
      go("atlas")
    },
    workflow,
    mediaDirection,
    setMediaDirection,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
