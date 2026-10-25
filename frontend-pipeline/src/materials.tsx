import { useEffect, useState } from "react";
import { api, projectPath } from "./api";
import { useStudio, useDraftState } from "./store";
export function useMaterials() {
  const { project } = useStudio();
  const [source, setSource] = useDraftState("shared.writing", "latest");
  const [materials, setMaterials] = useState<{writing: {id: string; title: string}[]; images: any[]; tracks: {id:string; title:string; mode:string}[]}>({writing: [], images: [], tracks: []});
  useEffect(() => {
    let active = true;
    setMaterials({writing: [], images: [], tracks: []});
    const load = () => { if (project.id) void api(projectPath("/api/ui/materials", project.id)).then((v) => { if (active) setMaterials(v); }).catch(() => {}); };
    load(); window.addEventListener("studio-refresh", load);
    return () => { active = false; window.removeEventListener("studio-refresh", load); };
  }, [project.id]);
  const chosen = source === "latest" ? materials.writing[0] : materials.writing.find((w) => w.id === source);
  return { ...materials, source, setSource, sourceTitle: source === "working" ? "Current editor text" : chosen?.title || project.title, sourceId: source === "working" ? "working" : chosen?.id || "manuscript" };
}
