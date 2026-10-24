import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { modeOf, now, QUEUE_LIMIT, seedStore, WORKERS } from "./data";
import type { ModeId, Project, ProjectTab, Run, Store, View } from "./types";

const KEY = "paramyth-studio-v3";

type Studio = {
  store: Store;
  setStore: (fn: (s: Store) => Store) => void;
  view: View;
  go: (v: View) => void;
  tab: ProjectTab;
  setTab: (t: ProjectTab) => void;
  project: Project;
  selectProject: (id: string, tab?: ProjectTab) => void;
  updateProject: (id: string, patch: Partial<Project> | ((p: Project) => Partial<Project>)) => void;
  startRun: (projectId: string, mode: ModeId, recoveredFrom?: string) => boolean;
  runAction: (id: string, action: "cancel" | "recover") => void;
  notify: (m: string) => void;
  toast: string;
};

const Ctx = createContext<Studio | null>(null);
export const useStudio = () => useContext(Ctx)!;

const load = (): Store => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "") as Store;
    if (s.projects?.length) return { ...seedStore(), ...s };
  } catch { /* fall through to seed */ }
  return seedStore();
};

export function StudioProvider({ children }: { children: ReactNode }) {
  const [store, setStoreRaw] = useState<Store>(load);
  const [view, setView] = useState<View>("overview");
  const [tab, setTab] = useState<ProjectTab>("manuscript");
  const [selectedId, setSelectedId] = useState(store.projects[0].id);
  const [toast, setToast] = useState("");
  const setStore = (fn: (s: Store) => Store) => setStoreRaw(fn);

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* storage unavailable */ } }, [store]);

  // Demo runner: advances active runs and promotes queued work while worker slots are free.
  useEffect(() => {
    const t = setInterval(() => setStoreRaw((s) => {
      let running = s.runs.filter((r) => r.status === "Running").length;
      const runs = s.runs.map((r): Run => {
        if (r.status === "Queued" && running < WORKERS) { running++; return { ...r, status: "Running", events: [...r.events, { at: now(), text: "Worker slot acquired" }] }; }
        if (r.status !== "Running") return r;
        const stages = modeOf(r.mode).stages;
        const progress = Math.min(1, r.progress + 0.04);
        const stage = stages[Math.min(stages.length - 1, Math.floor(progress * stages.length))];
        const events = stage !== r.stage ? [...r.events, { at: now(), text: `Stage: ${stage}` }] : r.events;
        return progress >= 1 ? { ...r, progress, stage, status: "Succeeded", events: [...events, { at: now(), text: "Run completed. Canon acceptance still requires bound reviews." }] } : { ...r, progress, stage, events };
      });
      return runs.some((r, i) => r !== s.runs[i]) ? { ...s, runs } : s;
    }), 3000);
    return () => clearInterval(t);
  }, []);

  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2600); };
  const project = store.projects.find((p) => p.id === selectedId) || store.projects[0];
  const updateProject: Studio["updateProject"] = (id, patch) => setStore((s) => ({ ...s, projects: s.projects.map((p) => p.id === id ? { ...p, ...(typeof patch === "function" ? patch(p) : patch), updated: now() } : p) }));

  const startRun: Studio["startRun"] = (projectId, mode, recoveredFrom) => {
    const active = store.runs.filter((r) => r.status === "Queued" || r.status === "Running").length;
    if (active >= QUEUE_LIMIT) { notify(`Queue full: ${QUEUE_LIMIT} submissions already queued or running`); return false; }
    const m = modeOf(mode);
    const run: Run = { id: `r-${Math.floor(1000 + Math.random() * 9000)}`, projectId, mode, status: "Queued", progress: 0, stage: m.stages[0], started: now(), recoveredFrom, events: [{ at: now(), text: recoveredFrom ? `Fresh recovery from ${recoveredFrom}: approved prefix retained, unfinished drafts re-checked` : `Dispatched ${m.workflow}` }] };
    setStore((s) => ({ ...s, runs: [run, ...s.runs] }));
    notify(`${m.name} run queued`);
    return true;
  };
  const runAction: Studio["runAction"] = (id, action) => {
    const run = store.runs.find((r) => r.id === id);
    if (!run) return;
    if (action === "cancel") {
      setStore((s) => ({ ...s, runs: s.runs.map((r) => r.id === id ? { ...r, status: "Cancelled", events: [...r.events, { at: now(), text: "Cancellation requested" }] } : r) }));
      notify("Run cancelled");
    } else startRun(run.projectId, run.mode, run.id);
  };

  const value: Studio = {
    store, setStore, view, go: setView, tab, setTab, project, toast, notify, updateProject, startRun, runAction,
    selectProject: (id, t) => { setSelectedId(id); if (t) setTab(t); setView("project"); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
