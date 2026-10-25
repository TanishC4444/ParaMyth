import { useEffect, useState } from "react"

import { api } from "../api"

import { PageTitle } from "../ui"

export default function Connections() {
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
        eyebrow="YOUR CONNECTED WORKSPACE"
        title="Connections"
        text="See which services are ready, manage your account, and explore every backend tool."
      />
      {error && (
        <p className="live-status error" role="alert">
          {error}
        </p>
      )}
      <section className="panel">
        <h2>Your account and team</h2>
        <p>Create your account to manage studio membership and invitations.</p>
        <div className="account-links">
          <a className="primary" href="/studio/teams.html?mode=signup">
            Create an account
          </a>
          <a className="secondary" href="/studio/teams.html">
            Sign in / Manage team
          </a>
        </div>
      </section>
      <section className="panel">
        <span className="eyebrow">LITERARY RETRIEVAL</span>
        <h2>
          {semantic ? "Semantic search connected" : "Enable semantic search"}
        </h2>
        <p>
          Story keyword search works with your corpus now. Add a Gemini
          embedding key to also search by meaning.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await api("/api/ui/retrieval-connection", { key })
              setKey("")
              setSemantic(true)
              setError("")
            } catch (e) {
              setError(String(e))
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
        </form>
        <p className="hint">
          Kept only in the current server session. Never included in project
          files.
        </p>
      </section>
      <div className="connections-grid">
        {Object.entries(data?.configured || {}).map(([key, ready]) => (
          <section className="panel" key={key}>
            <span className="eyebrow">
              {ready ? "CONNECTED" : "SETUP NEEDED"}
            </span>
            <h3>{labels[key] || key}</h3>
            <p>
              {ready
                ? "Available through your studio service."
                : "Add the connection to enable this tool."}
            </p>
            <a href="/connections" target="_blank" rel="noreferrer">
              Manage connection
            </a>
          </section>
        ))}
      </div>
      <section className="panel">
        <h2>Explore the full studio</h2>
        <p>
          The main workspace gives you a guided path. These advanced views
          expose runner graphs, individual API operations, configuration and
          full output details for testing.
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
      </section>
    </div>
  )
}
