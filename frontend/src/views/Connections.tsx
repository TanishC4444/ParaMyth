import { useEffect, useState } from "react"

import { api, optionalApi, backendUrl } from "../api"
import { useBackendPages } from '../backend-pages'

import { errorText, PageTitle, Status } from "../ui"
import { useAccess } from '../AccountGate'

export default function Connections() {
  const access = useAccess()
  const pages = useBackendPages(!!access.github_admin || !access.shared_keys)
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [semanticSupported,setSemanticSupported] = useState(true),
    [semantic, setSemantic] = useState(false),
    [key, setKey] = useState("")

  useEffect(() => {
    optionalApi("/api/ui/retrieval-connection")
      .then((v) => {setSemantic(!!v?.semantic);setSemanticSupported(!!v)})
      .catch((e) => setError(e.message))
    api("/api/studio/features")
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  const labels: Record<string, string> = {
    vultr: "Writing, scores and image backup",
    muse_image: "Muse image generation",
    serpapi: "Location and production research",
    google_oauth: "Google Calendar authorization",
    github_server_token: "GitHub workflows and artifacts",
  }

  return (
    <div className="page">
      <PageTitle
        eyebrow="WORKSPACE" title="Connections"
        text="The services that power your writing, visuals and production."
      >{!access.shared_keys && pages['/connections'] && <a className="secondary" href={backendUrl('/connections')} target="_blank" rel="noreferrer">Manage services ↗</a>}</PageTitle>
      {error && (
        <p className="live-status error" role="alert">
          {error}
        </p>
      )}
      <section className="panel">
        <div className="service-heading"><h2>Story search</h2><Status>{semantic ? "Connected" : "Keywords available"}</Status></div>
        <p>
          {access.shared_keys ? 'Your studio owner manages the search connection for this workspace.' : 'Story keyword search works with your corpus now. Add a Gemini embedding key to also search by meaning.'}
        </p>
        {access.shared_keys ? <p>Shared service keys stay on the server and are never sent to your browser.</p> : !semanticSupported ? <p className="hint">Search by meaning isn't available in this studio yet. You can still search by story keywords.</p> : <form
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await api("/api/ui/retrieval-connection", { key })
              setKey("")
              setSemantic(true)
              setError("")
            } catch (e) {
              setError(errorText(e))
            }
          }}
        >
          <label className="field">
            Gemini embedding key
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <button className="secondary" disabled={!key.trim()}>
            Connect semantic search
          </button>
        </form>}
        {!access.shared_keys && <p className="hint">
          Kept only in the current server session. Never included in project
          files.
        </p>}
      </section>
      <div className="connections-grid">
        {Object.entries(data?.configured || {}).filter(([key]) => access.github_admin || key !== "github_server_token").map(([key, ready]) => (
          <section className="panel" key={key}>
            <Status>{ready ? "Connected" : "Setup needed"}</Status>
            <h3>{labels[key] || key}</h3>
            <p>
              {ready
                ? "Available through your studio service."
                : access.shared_keys ? "The studio owner needs to configure this service." : "Add the connection to enable this tool."}
            </p>
          </section>
        ))}
      </div>
      {access.github_admin && Object.values(pages).some(Boolean) && <details className="panel advanced-connections"><summary>Advanced tools & administration</summary>
        <p>
          Developer tools for workflow dispatch, API inspection and diagnostics.
        </p>
        <div className="inline-links">
          {pages['/workflows'] && <a href={backendUrl('/workflows')} target="_blank" rel="noreferrer">
            All workflows, logs & artifacts
          </a>}
          {pages['/writing'] && <a href={backendUrl('/writing')} target="_blank" rel="noreferrer">
            Writing runner controls
          </a>}
          {pages['/testing'] && <a href={backendUrl('/testing')} target="_blank" rel="noreferrer">
            Backend test console
          </a>}
          {pages['/docs'] && <a href={backendUrl('/docs')} target="_blank" rel="noreferrer">
            Interactive API explorer
          </a>}
          {pages['/outputs'] && <a href={backendUrl('/outputs')} target="_blank" rel="noreferrer">
            Complete output browser
          </a>}
        </div>
        <div className="capability-list">
          {data?.features?.map((f: string) => <span key={f}>{f}</span>)}
        </div>
      </details>}
    </div>
  )
}
