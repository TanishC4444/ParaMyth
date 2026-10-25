import { useEffect, useSyncExternalStore } from "react";
import { api, projectPath } from "./api";
import { useStudio, useDraftState } from "./store";
type Materials = { writing: {id:string;title:string;status?:string}[]; images:any[]; tracks:{id:string;title:string;mode:string}[]; current?:{source_id:string;title:string;signature:string;status:string;excerpt:string;words:number}|null };
const empty: Materials = {writing:[],images:[],tracks:[]};
const caches = new Map<string, {value:Materials;listeners:Set<()=>void>;loading:boolean;again?:boolean;timer?:ReturnType<typeof setTimeout>;last:number}>();
function cache(key:string) {
  if (!caches.has(key)) caches.set(key,{value:empty,listeners:new Set(),loading:false,last:0});
  return caches.get(key)!;
}
async function load(id:string,source:string) {
  if (!id) return;
  const entry=cache(`${id}:${source}`);
  if (entry.loading) { entry.again=true; return; }
  entry.loading=true;
  try { entry.value=await api<Materials>(projectPath(`/api/ui/materials?source=${encodeURIComponent(source)}`,id)); entry.listeners.forEach(fn=>fn()); }
  catch { /* Keep the last successfully fetched project context during reconnects. */ }
  finally { entry.loading=false; entry.last=Date.now(); if(entry.again){entry.again=false;void load(id,source);} }
}
export function useMaterials() {
  const {project}=useStudio();
  const [source,setSource]=useDraftState('shared.writing','latest');
  const entry=cache(`${project.id}:${source}`);
  const materials=useSyncExternalStore(fn=>{entry.listeners.add(fn);return()=>{entry.listeners.delete(fn);};},()=>entry.value);
  useEffect(()=>{
    const refresh=()=>void load(project.id,source);
    const progress=(event:Event)=>{
      if ((event as CustomEvent).detail?.projectId!==project.id || entry.timer) return;
      entry.timer=setTimeout(()=>{entry.timer=undefined;refresh();},Math.max(0,900-(Date.now()-entry.last)));
    };
    refresh(); window.addEventListener('studio-refresh',refresh);window.addEventListener('studio-writing-progress',progress);
    return()=>{window.removeEventListener('studio-refresh',refresh);window.removeEventListener('studio-writing-progress',progress);};
  },[project.id,source,entry]);
  return {...materials,source,setSource,sourceTitle:materials.current?.title || project.title,sourceId:materials.current?.source_id || 'manuscript',signature:materials.current?.signature || '',streaming:materials.current?.status==='running'};
}
