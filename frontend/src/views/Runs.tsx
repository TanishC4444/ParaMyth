import { useEffect, useState } from "react"

import { api } from "../api"

import { useStudio } from "../store"

import { errorText, PageTitle, Status } from "../ui"

export default function Runs() {
  const { workflow, jobs, flush, refresh, project } = useStudio()

  const [catalog, setCatalog] = useState<any[]>([]),
    [repos, setRepos] = useState<string[]>([]),
    [repo, setRepo] = useState(""),
    [file, setFile] = useState(workflow),
    [ref, setRef] = useState("main"),
    [definition, setDefinition] = useState<any>(null),
    [inputs, setInputs] = useState<Record<string, any>>({}),
    [history, setHistory] = useState<any[]>([]),
    [detail, setDetail] = useState<any>(null),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false)

  const query = "?repository=" + encodeURIComponent(repo)

  const load = async () => {
    const v = await api("/api/studio/history" + query + "&limit=20")
    setHistory(v.workflow_runs)
  }

  useEffect(() => {
    let live = true
    api("/api/studio/workflows" + query + "&remote=true")
      .then((v) => {
        if (!live) return
        setCatalog(v.workflows)
        setRepos(v.repositories)
        if (!repo) setRepo(v.repositories[0] || "")
        if (!file)
          setFile(
            v.workflows.find((w: any) => w.file.includes("sequential"))?.file ||
              v.workflows[0]?.file ||
              "",
          )
      })
      .catch((e) => live && setError(e.message))
    api("/api/studio/history" + query + "&limit=20")
      .then((v) => live && setHistory(v.workflow_runs))
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [repo])

  useEffect(() => {
    if (!file) return
    let live = true
    setDefinition(null)
    api(
      "/api/studio/workflows/" +
        encodeURIComponent(file) +
        query +
        "&remote=true&ref=" +
        encodeURIComponent(ref),
    )
      .then((v) => {
        if (!live) return
        setDefinition(v)
        setInputs(
          Object.fromEntries(
            Object.entries(v.inputs).map(([k, s]: [string, any]) => [
              k,
              k === "backend"
                ? s.options?.find(
                    (o: string) => !["fixture", "demo"].includes(o),
                  ) || "vultr"
                : /request_file|brief_file/.test(k)
                  ? ""
                  : (s.default ?? ""),
            ]),
          ),
        )
      })
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [file, repo, ref])

  const dispatch = async () => {
    setBusy(true)
    setError("")
    try {
      await flush()
      if (
        Object.entries(inputs).some(
          ([k, v]) => /request_file|brief_file/.test(k) && !String(v).trim(),
        )
      )
        throw Error(
          "Choose your published story brief before starting a writing workflow.",
        )
      if (Object.values(inputs).some((v) => v === "fixture" || v === "demo"))
        throw Error("Choose a real provider for this live workspace.")
      await api(`/api/studio/workflows/${file}/dispatch`, {
        repository: repo,
        ref,
        inputs,
      })
      setStatus(
        "Workflow dispatched to GitHub. Its history will appear when GitHub starts the run.",
      )
      await load()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const publishCurrent=async()=>{
    setBusy(true);setError('');try{await flush();const brief=await api('/api/ui/projects/'+project.id+'/request');const name='paramyth-'+project.id;await api('/api/studio/briefs/publish',{brief,name,ref});setInputs(v=>({...v,...('request_file' in v?{request_file:name}:{})}));setStatus('Your brief was committed to examples/'+name+'.json on '+ref+'. Review the workflow inputs before starting.')}catch(e){setError(errorText(e))}finally{setBusy(false)}
  };
  const inspect = async (id: number) => {
    try {
      setDetail(await api("/api/studio/history/" + id + query))
    } catch (e) {
      setError(errorText(e))
    }
  }

  const action = async (name: string) => {
    try {
      await api(`/api/studio/history/${detail.run.id}/actions/${name}`, {
        repository: repo,
      })
      setStatus("Requested " + name + ".")
      await inspect(detail.run.id)
      await load()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="page">
      <PageTitle
        title="Writing & runs"
        text="Follow your studio jobs and GitHub writing workflows. While a draft is running, explore visuals, sound or production above."
      />
      {error && (
        <p className="live-status error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="live-status" role="status">
          {status}
        </p>
      )}
      <section className="panel">
        <div className="section-head">
          <h2>This story’s studio jobs</h2>
          <button className="text-action" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        <div className="job-list">
          {jobs.map((j) => (
            <article key={j.id}>
              <b>
                {j.kind} · {j.status}
              </b>
              <p>{j.message}</p>
              <small>{new Date(j.created_at).toLocaleString()}</small>
            </article>
          ))}
          {!jobs.length && <p className="quiet">No jobs yet for this story.</p>}
        </div>
      </section>
      <section className="panel">
        <h2>Start a writing workflow</h2>{project.id&&<button className="secondary" disabled={busy} onClick={()=>void publishCurrent()}>Publish this story’s brief to GitHub</button>}
        <p>
          Choose a workflow and its inputs. Publish your brief here or use the full
          writing controls to publish it before dispatching.
        </p>
        <div className="form-grid">
          <label className="field">
            Repository
            <select
              value={repo}
              onChange={(e) => {
                setRepo(e.target.value)
                setFile("")
              }}
            >
              {repos.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Workflow
            <select value={file} onChange={(e) => setFile(e.target.value)}>
              {catalog.map((w) => (
                <option key={w.file} value={w.file}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Branch or tag
            <input value={ref} onChange={(e) => setRef(e.target.value)} />
          </label>
        </div>
        {definition && (
          <>
            <details open>
              <summary>Workflow inputs</summary>
              <div className="workflow-inputs">
                {Object.entries(definition.inputs).map(
                  ([key, spec]: [string, any]) => (
                    <label className="field" key={key}>
                      {spec.description || key}
                      {spec.type === "choice" ? (
                        <select
                          value={inputs[key] ?? ""}
                          onChange={(e) =>
                            setInputs((v) => ({ ...v, [key]: e.target.value }))
                          }
                        >
                          {
                            <option value="" disabled>
                              Choose an option
                            </option>
                          }
                          {spec.options
                            .filter(
                              (o: string) => !["fixture", "demo"].includes(o),
                            )
                            .map((o: string) => (
                              <option key={o}>{o}</option>
                            ))}
                        </select>
                      ) : spec.type === "boolean" ? (
                        <input
                          type="checkbox"
                          checked={String(inputs[key]) === "true"}
                          onChange={(e) =>
                            setInputs((v) => ({
                              ...v,
                              [key]: e.target.checked,
                            }))
                          }
                        />
                      ) : (
                        <input
                          value={inputs[key] ?? ""}
                          required={!!spec.required}
                          onChange={(e) =>
                            setInputs((v) => ({
                              ...v,
                              [key]:
                                spec.type === "number"
                                  ? Number(e.target.value)
                                  : e.target.value,
                            }))
                          }
                        />
                      )}
                      <small>{key}</small>
                    </label>
                  ),
                )}
              </div>
            </details>
            <button
              className="primary"
              disabled={busy || !definition.dispatchable}
              onClick={() => void dispatch()}
            >
              Start this workflow
            </button>
            <details>
              <summary>
                Runner graph and source · {definition.jobs.length} jobs
              </summary>
              <pre className="real-output">
                {JSON.stringify(definition.jobs, null, 2)}
              </pre>
              <pre className="real-output">{definition.source}</pre>
            </details>
          </>
        )}
        <div className="inline-links">
          <a href="/workflows" target="_blank" rel="noreferrer">
            Full workflow tools & artifact import
          </a>
          <a href="/tools" target="_blank" rel="noreferrer">
            Publish or import a brief
          </a>
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>GitHub run history</h2>
          <button
            className="secondary"
            onClick={() => void load().catch((e) => setError(e.message))}
          >
            Refresh history
          </button>
        </div>
        <div className="runs-layout">
          <div className="review-list">
            {history.map((r) => (
              <button
                className="review-item run-row"
                key={r.id}
                onClick={() => void inspect(r.id)}
              >
                <div>
                  <Status>{`${r.status} · ${r.conclusion || "pending"}`}</Status>
                  <h3>{r.display_title || r.name}</h3>
                  <p>
                    {r.head_branch} · #{r.run_number} ·{" "}
                    {new Date(r.created_at).toLocaleString()}
                  </p>
                </div>
              </button>
            ))}
          </div>
          {detail && (
            <aside className="panel run-detail">
              <h2>{detail.run.display_title || detail.run.name}</h2>
              <p>
                {detail.run.status} · {detail.run.conclusion}
              </p>
              <a href={detail.run.html_url} target="_blank" rel="noreferrer">
                Open on GitHub
              </a>
              <div className="detail-actions">
                {detail.run.status !== "completed" ? (
                  <button
                    className="secondary"
                    onClick={() => void action("cancel")}
                  >
                    Cancel run
                  </button>
                ) : (
                  <>
                    <button
                      className="secondary"
                      onClick={() => void action("rerun-failed-jobs")}
                    >
                      Retry failed jobs
                    </button>
                    <button
                      className="secondary"
                      onClick={() => void action("rerun")}
                    >
                      Run again
                    </button>
                  </>
                )}
              </div>
              <h3>Runner jobs</h3>
              {detail.jobs.map((j: any) => (
                <p key={j.id}>
                  {j.name} · {j.status} · {j.conclusion}{" "}
                  <a
                    href={`/api/studio/history/${detail.run.id}/jobs/${j.id}/logs${query}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Logs
                  </a>
                </p>
              ))}
              <h3>Artifacts</h3>
              {detail.artifacts.map((a: any) => (
                <p key={a.id}>
                  {a.name} ·{" "}
                  {a.expired ? (
                    "Expired"
                  ) : (
                    <a
                      href={`/api/studio/history/${detail.run.id}/artifacts/${a.id}${query}&download=true`}
                    >
                      Download
                    </a>
                  )}
                </p>
              ))}
            </aside>
          )}
        </div>
      </section>
    </div>
  )
}
