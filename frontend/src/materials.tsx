import { useEffect, useSyncExternalStore } from "react";
import { api, optionalApi, projectPath, currentWorkspaceIdentity } from "./api";
import { useStudio, useDraftState } from "./store";
type Materials = { writing: {id:string;title:string;status?:string}[]; images:any[]; tracks:{id:string;title:string;mode:string}[]; current?:{source_id:string;title:string;signature:string;status:string;excerpt:string;words:number}|null };
const empty: Materials = {writing:[],images:[],tracks:[]};
export const projectAssets = (rows:any[],id:string) => rows.filter(row=>![row.project_id,row.job?.project_id,row.cue?.project_id].some(owner=>owner && owner!==id));
const caches = new Map<string, {value:Materials;listeners:Set<()=>void>;loading:boolean;again?:boolean;timer?:ReturnType<typeof setTimeout>;last:number}>();
function cache(key:string) {
  if (!caches.has(key)) caches.set(key,{value:empty,listeners:new Set(),loading:false,last:0});
  return caches.get(key)!;
}
async function load(id:string,source:string) {
  if (!id) return;
  const identity=currentWorkspaceIdentity();
  const entry=cache(`${identity}:${id}:${source}`);
  if (entry.loading) { entry.again=true; return; }
  entry.loading=true;
  try {
    const [materials,images,music]=await Promise.allSettled([
      optionalApi<Materials>(projectPath(`/api/ui/materials?source=${encodeURIComponent(source)}`,id)),
      api(projectPath('/api/images',id)),api(projectPath('/api/studio/music',id)),
    ]);
    if(identity!==currentWorkspaceIdentity())return;
    entry.value={...(materials.status==='fulfilled' && materials.value || entry.value),
      images:images.status==='fulfilled'?projectAssets(images.value.images || [],id):entry.value.images,
      tracks:music.status==='fulfilled'?projectAssets(music.value.tracks || [],id).filter(row=>row.job?.status==='completed').map(row=>({id:row.job.id,title:row.source_title || row.cue?.title || 'Saved soundtrack',mode:row.cue?.mode || 'score'})):entry.value.tracks};
    entry.listeners.forEach(fn=>fn());
  }
  catch { /* Keep the last successfully fetched project context during reconnects. */ }
  finally { entry.loading=false; entry.last=Date.now(); if(entry.again && identity===currentWorkspaceIdentity()){entry.again=false;void load(id,source);} }
}
export function useMaterials() {
  const {project}=useStudio();
  const [source,setSource]=useDraftState('shared.writing','latest');
  const entry=cache(`${currentWorkspaceIdentity()}:${project.id}:${source}`);
  const materials=useSyncExternalStore(fn=>{entry.listeners.add(fn);return()=>{entry.listeners.delete(fn);};},()=>entry.value);
  useEffect(()=>{
    const refresh=()=>void load(project.id,source);
    const progress=(event:Event)=>{
      if ((event as CustomEvent).detail?.projectId!==project.id || entry.timer) return;
      entry.timer=setTimeout(()=>{entry.timer=undefined;refresh();},Math.max(0,900-(Date.now()-entry.last)));
    };
    refresh(); window.addEventListener('studio-refresh',refresh);window.addEventListener('studio-shared-update',refresh);window.addEventListener('studio-writing-progress',progress);
    return()=>{clearTimeout(entry.timer);entry.timer=undefined;window.removeEventListener('studio-refresh',refresh);window.removeEventListener('studio-shared-update',refresh);window.removeEventListener('studio-writing-progress',progress);};
  },[project.id,source,entry]);
  return {...materials,refreshMaterials:()=>load(project.id,source),source,setSource,sourceTitle:materials.current?.title || project.title,sourceId:materials.current?.source_id || 'manuscript',signature:materials.current?.signature || '',streaming:materials.current?.status==='running'};
}
