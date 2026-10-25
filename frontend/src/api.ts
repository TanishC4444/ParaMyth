/** Product actions use the configured backend; the UI stays on its own origin. */
import { backendFetch, backendUrl, studioHost, currentStudioIdentity } from './transport'
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
        if (!r.ok) throw Error("Start the live studio server to continue.")
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
  if (identity !== 'local') headers['X-ParaMyth-Account'] = identity
  if (body !== undefined) headers["Content-Type"] = "application/json"
  if (!["GET", "HEAD"].includes(verb))
    headers["X-ParaMyth-Token"] = await token()
  if (identity !== accountIdentity || workspace !== currentWorkspaceIdentity()) throw Error('Your workspace changed. Reopen this project before continuing.')
  const r = await backendFetch(path, {
    method: verb,
    signal: path === "/api/ui/search" ? AbortSignal.timeout(60000) : path.startsWith("/api/studio/jobs") || path.startsWith("/api/ui/creative/jobs") || path.startsWith("/api/ui/jobs") ? AbortSignal.timeout(10000) : undefined,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  })
  const json = (r.headers.get("content-type") || "").includes("json")
  const value = json ? await r.json() : null
  if (!r.ok || !json) {
    if (r.status === 401) { csrf = undefined; window.dispatchEvent(new Event('paramyth-sign-in-required')) }
    if (r.status === 403) csrf = undefined
    const detail = value?.detail || value?.error
    const error = new Error(
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((e: any) => e.msg).join("; ")
          : `Live studio request failed (${r.status}). Check Connections.`,
    )
    Object.assign(error, {status:r.status})
    throw error
  }
  return value as T
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
    api<{ jobs: Job[] }>(projectPath("/api/ui/jobs", id)),
  ])
  const available = results.filter((r) => r.status === "fulfilled")
  if (!available.length) throw Error("Could not load running jobs. Check Connections.")
  return [...new Map(available.flatMap((r) => r.value.jobs).map((j) => [j.id, j])).values()]
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
