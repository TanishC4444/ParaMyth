import { useEffect, useState } from "react"
import { api, projectPath } from "../api"
import { useStudio, useDraftState } from "../store"
import { PageTitle } from "../ui"
export default function Library() {
  const { project } = useStudio()
  const [files, setFiles] = useState<any[]>([]),
    [q, setQ] = useDraftState("library.query", ""),
    [selected, setSelected] = useDraftState<any>("library.selected", null),
    [body, setBody] = useState(""),
    [error, setError] = useState("")
  const url = (f: any, download = false) =>
    projectPath(
      "/api/studio/output?path=" +
        encodeURIComponent(f.path) +
        (download ? "&download=true" : ""),
      project.id,
    )
  useEffect(() => {
    let live = true
    api(projectPath("/api/studio/outputs", project.id))
      .then((v) => live && setFiles(v.files))
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [project.id])
  useEffect(() => {
    let live = true
    setBody("")
    if (selected && /\.(txt|json|md|csv|ics)$/.test(selected.path))
      fetch(url(selected))
        .then(async (r) => {
          if (!r.ok) throw Error("Could not open output")
          const t = await r.text()
          if (live) setBody(t.slice(0, 100000))
        })
        .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [selected, project.id])
  return (
    <div className="page">
      <PageTitle
        title="Project files"
        text="Actual writing, images, soundtracks, research, review evidence and exports saved by your studio."
      />
      {error && <p role="alert">{error}</p>}
      <div className="toolbar">
        <label>
          <input
            aria-label="Find a file"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a file or output"
          />
        </label>
        <span>{files.length} saved files</span>
      </div>
      <div className="runs-layout">
        <div className="review-list">
          {files
            .filter((f) => f.path.toLowerCase().includes(q.toLowerCase()))
            .map((f) => (
              <button
                className="review-item file-row"
                key={f.path}
                onClick={() => setSelected(f)}
              >
                <span className="kind">{f.type.slice(1)}</span>
                <div>
                  <h3>{f.path.split("/").pop()}</h3>
                  <p>{f.path}</p>
                  <small>
                    {(f.bytes / 1024).toFixed(1)} KB ·{" "}
                    {new Date(f.modified * 1000).toLocaleString()}
                  </small>
                </div>
              </button>
            ))}
        </div>
        {selected && (
          <aside className="panel run-detail">
            <h2>{selected.path.split("/").pop()}</h2>
            {/\.(png|jpe?g|webp)$/.test(selected.path) ? (
              <img
                className="preview-image"
                src={url(selected)}
                alt={selected.path}
              />
            ) : /\.(wav|mp3|flac|opus)$/.test(selected.path) ? (
              <audio controls src={url(selected)} />
            ) : body ? (
              <pre className="real-output">{body}</pre>
            ) : (
              <p>Download this file to open it.</p>
            )}
            <a className="primary" href={url(selected, true)}>
              Download file
            </a>
          </aside>
        )}
      </div>
    </div>
  )
}
