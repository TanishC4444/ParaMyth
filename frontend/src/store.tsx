import { useAccess } from './AccountGate'
import {
  createContext,
  type ReactNode,
  type SetStateAction,
  type Dispatch,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react"
import { api as requestApi, currentAccountIdentity, currentWorkspaceIdentity, currentStudioIdentity, studioHost, projectPath, studioJobs, type Job } from "./api"
import { resolveRoute } from "./routes"
import { STATIC_SITE } from "./site"
import { uid, now, modeOf } from "./data"
import { errorText } from "./ui"
import type {
  CreativeSeed,
  ModeId,
  Project,
  ProjectTab,
  Store,
  View,
} from "./types"
const routeView = () => resolveRoute(location.hash)
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
type WorkspaceDrafts = Record<string, Record<string, any>>
type SharedConflict = {id:string;field:string;local:any;remote:any}
const backupKey = (id: string, account: string) => `paramyth-pending-drafts:${account}:${id}`
const viewField = (key:string) => key.startsWith('workflow.') || ['project.tab','writing.chapter','writing.scene'].includes(key)
const viewKey = (id:string,account:string) => 'paramyth-view:'+account+':'+id
function viewPreferences(id:string,account:string){try{return JSON.parse(localStorage.getItem(viewKey(id,account)) || '{}')}catch{return {}}}
function pendingBackup(id: string, account: string): Record<string, any> {
  try { return JSON.parse(localStorage.getItem(backupKey(id, account)) || "{}") } catch { return {} }
}

type Studio = {
  conflicts: SharedConflict[]
  resolveConflicts: (mine:boolean) => Promise<void>
  drafts: WorkspaceDrafts
  setDraft: (id: string, key: string, value: any) => void
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
/** Only authoring state belongs here; never persist credentials or live loading flags. */
export function useDraftState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const { project, drafts, setDraft } = useStudio()
  const fallback = useRef<T>(typeof initial === "function" ? (initial as () => T)() : initial)
  const value = Object.prototype.hasOwnProperty.call(drafts[project.id] || {}, key) ? drafts[project.id][key] as T : fallback.current
  const current = useRef(value)
  current.current = value
  const setValue = useCallback((next: SetStateAction<T>) => {
    const result = typeof next === "function" ? (next as (old: T) => T)(current.current) : next
    current.current = result
    setDraft(project.id, key, result === undefined ? null : result)
  }, [project.id, key, setDraft])
  return [value, setValue]
}
export function StudioProvider({ children }: { children: ReactNode }) {
  const access = useAccess()
  const account = useRef(currentAccountIdentity()+(currentStudioIdentity()?':'+currentStudioIdentity():'')).current
  const workspaceIdentity = useRef(currentWorkspaceIdentity()).current
  const readOnly = access.studio?.role === 'viewer'
  const active = useRef(true)
  async function api<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
    if (!active.current || workspaceIdentity !== currentWorkspaceIdentity()) throw Error('Your workspace changed. Reopen this project before continuing.')
    return requestApi<T>(path, body, method)
  }
  const [store, setRaw] = useState<Store>(empty),
    ref = useRef(store),
    [view, setView] = useState<View>(routeView),
    [selected, setSelected] = useState(""),
    [toast, setToast] = useState(""),
    [seed, setSeed] = useState<CreativeSeed | null>(null),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [jobs, setJobs] = useState<Job[]>([]),
    [saving, setSaving] = useState(false),
    [atlasQuery, setAtlasQuery] = useState(""),
    [workflow, setWorkflow] = useState(""),
    [drafts, setDrafts] = useState<WorkspaceDrafts>({})
  const draftsRef = useRef<WorkspaceDrafts>({})
  const draftVersions = useRef<Record<string,Record<string,string>>>({})
  const [conflicts,setConflicts] = useState<SharedConflict[]>([])
  const conflictServer = useRef<any>(null)
  const dirtyDrafts = useRef<WorkspaceDrafts>({})
  const dirty = useRef(new Map<string, Project>()),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    queue = useRef(Promise.resolve()),
    selection = useRef(""),
    notesDirty = useRef(false)
  useEffect(() => {
    active.current = true
    return () => { active.current = false; clearTimeout(timer.current) }
  }, [])
  const set = (s: Store) => {
    ref.current = s
    setRaw(s)
  }
  const go = (v: View) => {
    if(v==='atlas')v='retrieval'
    if (["creative", "images", "music", "production", "project"].includes(v)) {
      setDraft(selection.current, "workflow.section", ["images", "music", "production"].includes(v) ? "media" : "writing")
      if (["images", "music", "production"].includes(v)) setDraft(selection.current, "workflow.tool", v)
      else setDraft(selection.current, "workflow.writing", v === "project" ? "manuscript" : "creative")
      v = "workflow"
    }
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
          for (const [id, fields] of Object.entries(dirtyDrafts.current)) {
            if (!Object.keys(fields).length) continue
            const snapshot = { ...fields }
            const result = await api(`/api/ui/projects/${id}/workspace`, access.studio ? {changes:snapshot,versions:draftVersions.current[id] || {}} : snapshot, "PATCH")
            if(result.versions){
              const versions={...draftVersions.current[id]}
              for(const key of Object.keys(snapshot))versions[key]=result.versions[key]
              draftVersions.current[id]=versions
            }
            if (Object.keys(snapshot).some(key => key.startsWith("writing.") || key.startsWith("creative."))) window.dispatchEvent(new CustomEvent("studio-writing-progress", { detail: { projectId: id } }))
            for (const [key, value] of Object.entries(snapshot)) {
              if (dirtyDrafts.current[id]?.[key] === value) delete dirtyDrafts.current[id][key]
            }
            try { localStorage.setItem(backupKey(id, account), JSON.stringify(dirtyDrafts.current[id])) } catch {}
          }
          setError("")
        } catch (e) {
          if(access.studio && (e as any)?.status===409){
            const server=await api('/api/ui/workspace')
            conflictServer.current=server
            const rows:SharedConflict[]=[]
            for(const [id,local] of dirty.current){
              const remote=server.projects.find((p:Project)=>p.id===id)
              if(remote && remote.revision!==ref.current.projects.find(p=>p.id===id)?.revision)rows.push({id,field:'project',local,remote})
            }
            for(const [id,fields] of Object.entries(dirtyDrafts.current))for(const [field,local] of Object.entries(fields)){
              if((draftVersions.current[id]?.[field] || 'new')!==(server.draftRevisions?.[id]?.[field] || 'new'))rows.push({id,field,local,remote:server.drafts?.[id]?.[field]})
            }
            setConflicts(rows)
          }
          setError(e instanceof Error ? e.message : "Could not save")
          throw e
        } finally {
          setSaving(false)
        }
      })
    return queue.current
  }, [])
  const refresh = useCallback(async () => {
    if (access.accounts_required && !access.authenticated) { setReady(true); return }
    if (STATIC_SITE) {
      setReady(true)
      return
    }
    try {
      const value = await api<{
        projects: Project[]
        current: string
        ideas: Store["ideas"]
        pins: Store["pins"]
        drafts: WorkspaceDrafts
        draftRevisions?: Record<string,Record<string,string>>
      }>("/api/ui/workspace")
      const restored: WorkspaceDrafts = {}
      for (const p of value.projects) {
        const pending = readOnly ? {} : { ...pendingBackup(p.id, account), ...dirtyDrafts.current[p.id] }
        dirtyDrafts.current[p.id] = pending
        restored[p.id] = access.studio ? {...value.drafts?.[p.id],...viewPreferences(p.id,account),...pending} : { ...value.drafts?.[p.id], ...draftsRef.current[p.id], ...viewPreferences(p.id,account),...pending }
        const versions={...value.draftRevisions?.[p.id]}
        for(const key of Object.keys(pending))versions[key]=draftVersions.current[p.id]?.[key] || 'new'
        draftVersions.current[p.id]=versions
      }
      draftsRef.current = restored
      setDrafts(restored)
      if (Object.values(dirtyDrafts.current).some((fields) => Object.keys(fields).length)) {
        clearTimeout(timer.current)
        timer.current = setTimeout(() => void flush().catch(() => {}), 700)
      }
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
        setJobs(await studioJobs(id))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Live studio unavailable")
      setReady(true)
    }
  }, [flush, access.accounts_required, access.authenticated, access.studio?.id])
  useEffect(() => {
    void refresh()
    const changed = () => {
      // Links such as #/images open the matching workflow tab, the same as the in-app buttons.
      const raw = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0] as View
      if (["creative", "images", "music", "production", "project"].includes(raw)) go(raw)
      else setView(routeView())
    }
    const update = () => void refresh()
    window.addEventListener("hashchange", changed)
    window.addEventListener("studio-refresh", update)
    const interval = setInterval(async () => {
      if (document.hidden) return
      if(access.studio && !dirty.current.size && !notesDirty.current && !Object.values(dirtyDrafts.current).some(fields=>Object.keys(fields).length)){
        await refresh()
        window.dispatchEvent(new Event('studio-shared-update'))
        return
      }
      if (!selection.current) return
      try {
        setJobs(await studioJobs(selection.current))
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
      if (dirty.current.size || notesDirty.current || Object.values(dirtyDrafts.current).some((fields) => Object.keys(fields).length)) {
        e.preventDefault()
        e.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", before)
    return () => window.removeEventListener("beforeunload", before)
  }, [])
  const setDraft = useCallback((id: string, key: string, value: any) => {
    if (!id) return
    if (JSON.stringify(draftsRef.current[id]?.[key]) === JSON.stringify(value)) return
    const next = { ...draftsRef.current, [id]: { ...draftsRef.current[id], [key]: value } }
    draftsRef.current = next
    setDrafts(next)
    if(viewField(key)){
      try{localStorage.setItem(viewKey(id,account),JSON.stringify({...viewPreferences(id,account),[key]:value}))}catch{}
      return
    }
    if(readOnly)return
    dirtyDrafts.current[id] = { ...dirtyDrafts.current[id], [key]: value }
    try { localStorage.setItem(backupKey(id, account), JSON.stringify(dirtyDrafts.current[id])) } catch {}
    setSaving(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush().catch(() => {}), 700)
  }, [flush])
  const setStore = (fn: (s: Store) => Store) => {
    if(readOnly)return
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
  const startingAtlas = useRef(false)
  const selectProject = (id: string, t?: ProjectTab) => {
    void (async () => {
      try {
        await flush()
        await api("/api/studio/project/select", { id })
        selection.current = id
        setSelected(id)
        if (t) setDraft(id, "project.tab", t)
          setDraft(id, "workflow.section", "writing")
          setDraft(id, "workflow.writing", t === "brief" ? "brief" : t ? "manuscript" : "creative")
        go("workflow")
        await refresh()
      } catch (e) {
        notify(errorText(e))
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
    conflicts,
    resolveConflicts:async(mine)=>{
      const server=conflictServer.current
      if(!server)return
      for(const row of conflicts){
        if(row.field==='project'){
          if(mine){
            const local=dirty.current.get(row.id)
            if(local)dirty.current.set(row.id,{...local,revision:row.remote.revision})
            set({...ref.current,projects:ref.current.projects.map(p=>p.id===row.id?{...p,revision:row.remote.revision}:p)})
          }else{
            dirty.current.delete(row.id)
            set({...ref.current,projects:ref.current.projects.map(p=>p.id===row.id?row.remote:p)})
          }
        }else{
          draftVersions.current[row.id]={...draftVersions.current[row.id],[row.field]:server.draftRevisions?.[row.id]?.[row.field] || 'new'}
          if(!mine){
            delete dirtyDrafts.current[row.id]?.[row.field]
            draftsRef.current={...draftsRef.current,[row.id]:{...draftsRef.current[row.id],[row.field]:row.remote}}
          }
          try{localStorage.setItem(backupKey(row.id,account),JSON.stringify(dirtyDrafts.current[row.id] || {}))}catch{}
        }
      }
      setDrafts(draftsRef.current);setConflicts([])
      await flush();await refresh()
    },
    store,
    drafts,
    setDraft,
    setStore,
    view,
    go,
    tab: drafts[project.id]?.["project.tab"] || "brief",
    setTab: (t) => setDraft(project.id, "project.tab", t),
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
      if (!studioHost() || access.accounts_required && !access.authenticated) { location.hash = '#/signup'; return }
      if (startingAtlas.current) return
      startingAtlas.current = true
      void (async () => {
        try {
          const next = blankProject()
          next.title = `Inspired by ${s.source.title}`.slice(0, 150)
          next.brief.premise = s.input
          const saved = await createProject(next)
          setDraft(saved.id, "creative.input", s.input)
          setDraft(saved.id, "creative.source", s.source)
          setDraft(saved.id, "creative.context", false)
          setDraft(saved.id, "writing.chapter", 1)
          setDraft(saved.id, "workflow.writing", "creative")
          setDraft(saved.id, "workflow.section", "writing")
          await flush()
          go("workflow")
          notify("New project created from your atlas inspiration.")
        } catch (e) { notify(errorText(e)) }
        finally { startingAtlas.current = false }
      })()
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
    mediaDirection: drafts[project.id]?.["shared.direction"] || "",
    setMediaDirection: (direction) => setDraft(project.id, "shared.direction", direction),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
