import { useEffect, useRef } from "react"
import { optionalApi, projectPath, studioJobs, type Job } from "./api"
import { requestMessage } from './request-errors'
import { useDraftState, useStudio } from "./store"

type Handle = { id: string; kind: string; local?: boolean }
/** Watch existing jobs only. Navigation, refresh and network retries never submit work. */
export function useSavedJob(
  field: string,
  kinds: readonly string[],
  callbacks: { progress: (job: Job) => void; complete: (job: Job) => Promise<void>; failed: (message: string) => void },
) {
  const { project } = useStudio()
  const [handle, setHandle] = useDraftState<Handle | null>(field, null)
  const latest = useRef(callbacks)
  latest.current = callbacks
  const kindKey = kinds.join(",")
  useEffect(() => {
    let live = true
    if (!project.id) return
    // Recover work started in another tab, even before its local handle was saved.
    const recover = () => studioJobs(project.id).then((jobs) => {
      const active = jobs.find((j) => kinds.includes(j.kind) && ["queued", "running"].includes(j.status))
      if (live && active) setHandle((current) => current || { id: active.id, kind: active.kind, local: active.local })
    }).catch((e) => { if (live) latest.current.failed(String(e)) })
    void recover()
    window.addEventListener('studio-shared-update',recover)
    return () => { live = false; window.removeEventListener('studio-shared-update',recover) }
  }, [project.id, kindKey, setHandle])
  useEffect(() => {
    if (!handle) return
    let live = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const job = await optionalApi<Job>(projectPath((handle.local ? "/api/ui/jobs/" : "/api/job/") + handle.id, project.id))
        if (!live) return
        if(!job){setHandle(null);return}
        latest.current.progress({...job,message:job.message?requestMessage(job.message):''})
        if (job.status === "complete") {
          await latest.current.complete(job)
          window.dispatchEvent(new Event("studio-refresh"))
          if (live) setHandle((current) => current?.id === handle.id ? null : current)
          return
        }
        if (["failed", "interrupted", "cancelled"].includes(job.status)) {
          latest.current.failed(requestMessage(job.message))
          window.dispatchEvent(new Event("studio-refresh"))
          setHandle((current) => current?.id === handle.id ? null : current)
          return
        }
      } catch (e) {
        if (live) latest.current.failed(`Reconnecting to your saved job. ${e instanceof Error ? e.message : String(e)}`)
      }
      if (live) timer = setTimeout(() => void poll(), 2000)
    }
    void poll()
    return () => { live = false; clearTimeout(timer) }
  }, [handle?.id, setHandle])
  return [handle, setHandle] as const
}
