import { useEffect, useRef, useState } from "react"
import { api, backendFetch, projectPath } from "../api"
import { useStudio, useDraftState } from "../store"
import { EmptyState, Icon, PageTitle } from "../ui"
export default function Library({ embedded = false }: { embedded?: boolean }) {
  const { project } = useStudio()
  const preview = useRef<HTMLElement>(null)
  const lastFile = useRef<HTMLButtonElement>(null)
  const [files, setFiles] = useState<any[]>([]),
    [q, setQ] = useDraftState("library.query", ""),
    [selected, setSelected] = useDraftState<any>("library.selected", null),
    [body, setBody] = useState(""),
    [error, setError] = useState("")
  useEffect(() => {
    if (!selected) return
    preview.current?.focus({ preventScroll:true })
    if (matchMedia("(max-width: 1100px)").matches) preview.current?.scrollIntoView({behavior:"instant",block:"start"})
  }, [selected?.path])
  const [revision,setRevision]=useState(0)
  useEffect(()=>{const changed=()=>setRevision(value=>value+1);window.addEventListener('studio-shared-update',changed);return()=>window.removeEventListener('studio-shared-update',changed)},[])
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
  }, [project.id,revision])
  useEffect(() => {
    let live = true
    setBody("")
    if (selected && /\.(txt|json|md|csv|ics)$/.test(selected.path))
      backendFetch(url(selected))
        .then(async (r) => {
          if (!r.ok) throw Error("Could not open output")
          const t = await r.text()
          if (live) setBody(t.slice(0, 100000))
        })
        .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [selected, project.id,revision])
  const fileTitle = (path: string) => {
    const titles: Record<string,string> = {"author-draft.txt":"Working manuscript","story.txt":"Saved story","author-original-request.json":"Original brief","author-workspace.json":"Project workspace","request.json":"Generation brief","workspace-drafts.json":"Workspace drafts"}
    return path.startsWith("author-revisions/") ? "Manuscript checkpoint" : titles[path] || path.split("/").pop()
  }
  const filtered = files.filter(f => f.path.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="page">
      <PageTitle level={embedded ? "h2" : "h1"}
        eyebrow="WORKSPACE" title="Project files"
        text="Writing, media and exports saved with this project."
      />
      {error && <p role="alert">{error}</p>}
      <div className="toolbar">
        <label><Icon name="search" size={17} />
          <input
            aria-label="Find a file"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a file or output"
          />
        </label>
        <span>{filtered.length} {filtered.length === 1 ? "file" : "files"}</span>
      </div>
      <div className="runs-layout">
        {filtered.length ? <div className="review-list">
          {filtered.map((f) => (
              <button
                className={`review-item file-row${selected?.path === f.path ? " selected" : ""}`}
                aria-pressed={selected?.path === f.path}
                key={f.path}
                onClick={event => { lastFile.current = event.currentTarget; setSelected(f) }}
              >
                <span className="kind">{f.type.slice(1)}</span>
                <div>
                  <h3>{fileTitle(f.path)}</h3>
                  {fileTitle(f.path) !== f.path && <p>{f.path}</p>}
                  <small>
                    {(f.bytes / 1024).toFixed(1)} KB ·{" "}
                    {new Date(f.modified * 1000).toLocaleString()}
                  </small>
                </div>
              </button>
            ))}
        </div> : <EmptyState icon={files.length ? "search" : "library"} title={files.length ? "No files match your search" : "Everything you make, collected"} text={files.length ? "Try another file name or clear your search." : "Saved manuscripts, visuals, soundtracks and production exports will appear here as you create them."} action={q ? <button className="secondary" onClick={() => setQ("")}>Clear search</button> : undefined} />}
        {selected && (
          <aside ref={preview} className="panel run-detail file-preview" tabIndex={-1} aria-label="File preview">
            <div className="section-head"><h2>{fileTitle(selected.path)}</h2><button className="icon-button" onClick={() => { setSelected(null); lastFile.current?.focus() }} aria-label="Close file preview"><Icon name="close" size={16} /></button></div>
            {/\.(png|jpe?g|webp)$/.test(selected.path) ? (
              <img
                className="preview-image"
                src={url(selected)}
                alt={selected.path}
              />
            ) : /\.(wav|mp3|flac|opus)$/.test(selected.path) ? (
              <audio controls src={url(selected)} />
            ) : body ? (
              <pre className="real-output">{body.trimEnd()}</pre>
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
