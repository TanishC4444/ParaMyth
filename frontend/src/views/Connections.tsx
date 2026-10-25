import { useEffect, useState } from "react"

import { api } from "../api"

import { errorText, PageTitle, Status } from "../ui"
import { useAccess } from '../AccountGate'

export default function Connections() {
  const access = useAccess()
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [semantic, setSemantic] = useState(false),
    [key, setKey] = useState("")

  useEffect(() => {
    api("/api/ui/retrieval-connection")
      .then((v) => setSemantic(v.semantic))
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
      >{!access.shared_keys && <a className="secondary" href="/connections" target="_blank" rel="noreferrer">Manage services ↗</a>}</PageTitle>
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
        {access.shared_keys ? <p>Shared service keys stay on the server and are never sent to your browser.</p> : <form
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
      {access.github_admin && <details className="panel advanced-connections"><summary>Advanced tools & administration</summary>
        <p>
          Developer tools for workflow dispatch, API inspection and diagnostics.
        </p>
        <div className="inline-links">
          <a href="/workflows" target="_blank" rel="noreferrer">
            All workflows, logs & artifacts
          </a>
          <a href="/writing" target="_blank" rel="noreferrer">
            Writing runner controls
          </a>
          <a href="/testing" target="_blank" rel="noreferrer">
            Backend test console
          </a>
          <a href="/docs" target="_blank" rel="noreferrer">
            Interactive API explorer
          </a>
          <a href="/outputs" target="_blank" rel="noreferrer">
            Complete output browser
          </a>
        </div>
        <div className="capability-list">
          {data?.features.map((f: string) => <span key={f}>{f}</span>)}
        </div>
      </details>}
    </div>
  )
}
