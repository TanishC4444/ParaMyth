/** Product actions use the configured backend; the UI stays on its own origin. */
import { backendFetch, backendUrl, studioHost, currentStudioIdentity } from './transport'
import { requestMessage } from './request-errors'
export { backendFetch, backendUrl, studioHost, currentStudioIdentity, setStudioIdentity } from './transport'
const offline = "The online studio is not connected yet. You can still explore the story atlas."
let csrf: Promise<string> | undefined
let accountIdentity = 'local'
export const currentAccountIdentity = () => accountIdentity
export const currentWorkspaceIdentity = () => accountIdentity + ':' + currentStudioIdentity()
export function setAccountIdentity(id: string) { if (accountIdentity !== id) { accountIdentity = id; csrf = undefined } }
async function token() {
  if (!studioHost()) throw Error(offline)
  if (!csrf)
    csrf = backendFetch("/api/ui/session", {
      cache: "no-store",
    })
      .then(async (r) => {
        if (r.status === 401) window.dispatchEvent(new Event('paramyth-sign-in-required'))
        if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw Error("We couldn't reach your studio. Try again in a moment.")
        return (await r.json()).csrf as string
      })
      .catch((e) => {
        csrf = undefined
        throw e
      })
  return csrf
}
export async function api<T = any>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  if (!studioHost()) throw Error(offline)
  const identity = accountIdentity
  const workspace = currentWorkspaceIdentity()
  const verb = method || (body === undefined ? "GET" : "POST")
  const headers: Record<string, string> = { Accept: "application/json" }
  const binary = typeof Blob !== 'undefined' && body instanceof Blob
  if (identity !== 'local') headers['X-ParaMyth-Account'] = identity
  if (body !== undefined) headers["Content-Type"] = binary ? body.type || 'application/octet-stream' : "application/json"
  if (!["GET", "HEAD"].includes(verb))
    headers["X-ParaMyth-Token"] = await token()
  if (identity !== accountIdentity || workspace !== currentWorkspaceIdentity()) throw Error('Your workspace changed. Reopen this project before continuing.')
  let r: Response
  try { r = await backendFetch(path, {
    method: verb,
    signal: path === "/api/ui/search" ? AbortSignal.timeout(60000) : path.startsWith("/api/studio/jobs") || path.startsWith("/api/ui/creative/jobs") || path.startsWith("/api/ui/jobs") ? AbortSignal.timeout(10000) : AbortSignal.timeout(30000),
    headers,
    body: binary ? body : body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  }) } catch (error) { throw Error(requestMessage(error instanceof Error ? error.message : error)) }
  const json = (r.headers.get("content-type") || "").includes("json")
  const value = json ? await r.json().catch(() => null) : null
  if (!r.ok || !json || value === null) {
    if (r.status === 401) { csrf = undefined; window.dispatchEvent(new Event('paramyth-sign-in-required')) }
    if (r.status === 403) csrf = undefined
    const detail = value?.detail || value?.error
    const raw = (
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((e: any) => e.msg).join("; ")
          : ''
    )
    if(/_API_KEY|server environment/.test(raw))console.warn('Studio service configuration:',raw)
    const error = new Error(requestMessage(raw, r.status))
    Object.assign(error, {status:r.status})
    throw error
  }
  return value as T
}
const missing = new Set<string>()
/** Older studios may not serve optional tools. Stop requesting a missing endpoint. */
export async function optionalApi<T = any>(path: string): Promise<T | null> {
  const key = currentWorkspaceIdentity()+':'+new URL(path, location.origin).pathname
  if (missing.has(key)) return null
  try { return await api<T>(path) }
  catch (error) { if ((error as any)?.status === 404) { missing.add(key); return null } throw error }
}
export type Job = {
  id: string
  kind: string
  project_id: string
  status: string
  message: string
  created_at: string
  result?: any
  local?: boolean
  streaming?: boolean
  preview?: { record_id: string; stage: string; context_chapter?: number; chapter?: number; scene_id?: string; title?: string; text?: string; summary?: string }
}
export const projectPath = (path: string, id: string) =>
  backendUrl(`${path}${path.includes("?") ? "&" : "?"}project_id=${encodeURIComponent(id)}`)
export async function studioJobs(id: string): Promise<Job[]> {
  const results = await Promise.allSettled([
    api<{ jobs: Job[] }>(projectPath("/api/studio/jobs", id)),
    optionalApi<{ jobs: Job[] }>(projectPath("/api/ui/jobs", id)),
  ])
  const available = results.flatMap((r) => r.status === "fulfilled" && r.value ? [r.value] : [])
  if (!available.length) throw Error("Could not load running jobs. Check Connections.")
  return [...new Map(available.flatMap((r) => r.jobs).map((j) => [j.id, j])).values()]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}
export async function waitJob(
  id: string,
  update?: (job: Job) => void,
  signal?: AbortSignal,
): Promise<Job> {
  while (!signal?.aborted) {
    const j = await api<Job>("/api/job/" + id)
    update?.(j)
    if (j.status === "complete") return j
    if (["failed", "interrupted", "cancelled"].includes(j.status))
      throw Error(j.message)
    await new Promise((r) => setTimeout(r, 1800))
  }
  throw new DOMException("Stopped watching", "AbortError")
}
