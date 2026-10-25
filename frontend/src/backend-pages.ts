import { useEffect, useState } from 'react'
import { backendFetch } from './transport'

const paths=['/connections','/workflows','/writing','/testing','/docs','/outputs','/tools']
/** Hosted studios do not necessarily ship the local administration pages. */
export function useBackendPages(enabled:boolean) {
  const [available,setAvailable]=useState<Record<string,boolean>>({})
  useEffect(()=>{
    if(!enabled)return
    let active=true
    void Promise.all(paths.map(async path=>{
      try{
        const response=await backendFetch(path,{signal:AbortSignal.timeout(10000),cache:'no-store'})
        return [path,response.ok && (response.headers.get('content-type') || '').includes('text/html') && (!response.url || new URL(response.url).pathname===path)] as const
      }catch{return [path,false] as const}
    })).then(rows=>{if(active)setAvailable(Object.fromEntries(rows))})
    return()=>{active=false}
  },[enabled])
  return available
}
