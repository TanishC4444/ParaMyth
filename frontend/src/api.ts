/** All product actions use the same-origin live server. No fixture fallback. */
let csrf: Promise<string> | undefined
async function token() {
  if (!csrf)
    csrf = fetch("/api/ui/session", {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (r) => {
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
  const verb = method || (body === undefined ? "GET" : "POST")
  const headers: Record<string, string> = { Accept: "application/json" }
  if (body !== undefined) headers["Content-Type"] = "application/json"
  if (!["GET", "HEAD"].includes(verb))
    headers["X-ParaMyth-Token"] = await token()
  const r = await fetch(path, {
    method: verb,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
  })
  const json = (r.headers.get("content-type") || "").includes("json")
  const value = json ? await r.json() : null
  if (!r.ok || !json) {
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
}
export const projectPath = (path: string, id: string) =>
  `${path}${path.includes("?") ? "&" : "?"}project_id=${encodeURIComponent(id)}`
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
