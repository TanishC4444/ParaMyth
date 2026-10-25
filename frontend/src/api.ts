/** All product actions use the same-origin live server. No fixture fallback. */
let csrf: Promise<string> | undefined
let accountIdentity = 'local'
export const currentAccountIdentity = () => accountIdentity
export function setAccountIdentity(id: string) { if (accountIdentity !== id) { accountIdentity = id; csrf = undefined } }
async function token() {
  if (!csrf)
    csrf = fetch("/api/ui/session", {
      credentials: "same-origin",
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
  const identity = accountIdentity
  const verb = method || (body === undefined ? "GET" : "POST")
  const headers: Record<string, string> = { Accept: "application/json" }
  if (identity !== 'local') headers['X-ParaMyth-Account'] = identity
  if (body !== undefined) headers["Content-Type"] = "application/json"
  if (!["GET", "HEAD"].includes(verb))
    headers["X-ParaMyth-Token"] = await token()
  if (identity !== accountIdentity) throw Error('Your account changed. Reload this page before continuing.')
  const r = await fetch(path, {
    method: verb,
    signal: path === "/api/ui/search" ? AbortSignal.timeout(60000) : path.startsWith("/api/studio/jobs") || path.startsWith("/api/ui/creative/jobs") || path.startsWith("/api/ui/jobs") ? AbortSignal.timeout(10000) : undefined,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
  })
  const json = (r.headers.get("content-type") || "").includes("json")
  const value = json ? await r.json() : null
  if (!r.ok || !json) {
    if (r.status === 401) { csrf = undefined; window.dispatchEvent(new Event('paramyth-sign-in-required')) }
    if (r.status === 403) csrf = undefined
    const detail = value?.detail || value?.error
    throw Error(
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((e: any) => e.msg).join("; ")
          : `Live studio request failed (${r.status}). Check Connections.`,
    )
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
  `${path}${path.includes("?") ? "&" : "?"}project_id=${encodeURIComponent(id)}`
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
