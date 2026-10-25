import { useEffect, useState } from "react"
import { useSavedJob } from "../useSavedJob"
import { api, projectPath } from "../api"
import { useStudio, useDraftState } from "../store"
import { PageTitle } from "../ui"
export default function Production() {
  const { project, mediaDirection, flush, refresh } = useStudio()
  const [config, setConfig] = useDraftState<any>("production.config", {
    region: "",
    start_date: new Date().toISOString().slice(0, 10),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    currency: "USD",
    day_hours: 10,
    setup_minutes: 30,
    move_minutes: 45,
    contingency: 15,
    budget_cap: 0,
    search_limit: 2,
    skip_weekends: true,
  })
  const [plan, setPlan] = useDraftState<any>("production.plan", null),
    [ids, setIds] = useState<string[]>([]),
    [images, setImages] = useState<any[]>([]),
    [imageId, setImageId] = useDraftState("production.imageId",
      sessionStorage.getItem("paramyth-scout-" + project.id) || "",
    ),
    [submitting, setSubmitting] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [scenes, setScenes] = useDraftState<any[]>("production.scenes", []),
    [budget, setBudget] = useDraftState<any[]>("production.budget", []),
    [google, setGoogle] = useState(false)
  const [pendingJob, setPendingJob] = useSavedJob("production.pendingJob", ["production"], {
    progress: (j) => { setStatus(j.message); setError("") },
    complete: async (j) => {
      open(j.result)
      setIds((v) => [j.result.id, ...v.filter((x) => x !== j.result.id)])
      setStatus("Your production plan is ready.")
      await refresh()
    },
    failed: setError,
  })
  const busy = submitting || !!pendingJob
  const path = (p: string) => projectPath(p, project.id)
  const open = (p: any) => {
    setPlan(p)
    setConfig(p.config)
    setScenes(p.breakdown.scenes)
    setBudget(p.breakdown.budget_items)
  }
  useEffect(() => {
    let live = true
    api(path("/api/config"))
      .then(async (c) => {
        if (!live) return
        setIds(c.plans)
        setGoogle(c.google)
        if (c.plans.length && !plan) {
          const p = await api(path("/api/plan/" + c.plans[0]))
          if (live) { setPlan(p); if (!scenes.length) setScenes(p.breakdown.scenes); if (!budget.length) setBudget(p.breakdown.budget_items); }
        }
      })
      .catch((e) => live && setError(e.message))
    api(path("/api/images"))
      .then(
        (v) =>
          live &&
          setImages(v.images.filter((x: any) => x.status === "completed")),
      )
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [project.id])
  const create = async () => {
    setSubmitting(true)
    setError("")
    try {
      await flush()
      let references: any[] = []
      if (imageId) {
        const response = await fetch(path(`/media/images/${imageId}/0.png`))
        if (!response.ok) throw Error("Could not load selected image")
        const blob = await response.blob()
        if (blob.size > 5 * 1024 * 1024)
          throw Error("Choose a reference image under 5 MB")
        const encoded = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(String(r.result).split(",")[1])
          r.onerror = reject
          r.readAsDataURL(blob)
        })
        references = [{ mime: "image/png", data: encoded }]
      }
      const q = await api(path("/api/generate"), {
        config: { ...config, brief: mediaDirection },
        images: references,
      })
      setPendingJob({ id: q.job_id, kind: "production" })
      await refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setSubmitting(false)
    }
  }
  const recalc = async () => {
    setSubmitting(true)
    try {
      const result = await api(path("/api/recalculate"), {
        id: plan.id,
        config,
        scenes,
        budget_items: budget,
      })
      open(result)
      setIds((v) => [result.id, ...v.filter((x) => x !== result.id)])
      setStatus("Schedule and budget recalculated and saved.")
    } catch (e) {
      setError(String(e))
    } finally {
      setSubmitting(false)
    }
  }
  const set = (k: string, v: any) => setConfig((c: any) => ({ ...c, [k]: v }))
  return (
    <div className="page simple-workspace">
      <PageTitle
        eyebrow=""
        title="Production"
        text="Turn your story into a shoot schedule, budget and location plan."
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
      <div className="production-layout">
        <section className="panel composer">
          <h2>Plan your shoot</h2>
          <div className="form-grid">
            <label className="field">
              Filming region
              <input
                value={config.region}
                onChange={(e) => set("region", e.target.value)}
                placeholder="City or region"
              />
            </label>
            <label className="field">
              Start date
              <input
                type="date"
                value={config.start_date}
                onChange={(e) => set("start_date", e.target.value)}
              />
            </label>
          </div>
          <details className="workspace-options"><summary>Budget & visual reference</summary>
            <div className="form-grid">
            <label className="field">
              Currency
              <input
                value={config.currency}
                maxLength={3}
                onChange={(e) => set("currency", e.target.value.toUpperCase())}
              />
            </label>
            <label className="field">
              Budget cap
              <input
                type="number"
                min={0}
                value={config.budget_cap || ""}
                placeholder="Undecided"
                onChange={(e) => set("budget_cap", Number(e.target.value))}
              />
            </label>
          </div>
          <label className="field">
            Visual reference
            <select
              value={imageId}
              onChange={(e) => {
                setImageId(e.target.value)
                sessionStorage.setItem(
                  "paramyth-scout-" + project.id,
                  e.target.value,
                )
              }}
            >
              <option value="">Story only</option>
              {images.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title}
                </option>
              ))}
            </select>
          </label>
          {imageId && (
            <img
              className="preview-image"
              src={path(`/media/images/${imageId}/0.png`)}
              alt="Selected location reference"
            />
          )}
          </details>
          <details>
            <summary>Schedule settings</summary>
            <div className="form-grid">
              {[
                ["day_hours", "Workday hours"],
                ["setup_minutes", "Setup minutes"],
                ["move_minutes", "Move minutes"],
                ["contingency", "Contingency %"],
                ["search_limit", "Research searches (0–3)"],
              ].map(([key, label]) => (
                <label key={key} className="field">
                  {label}
                  <input
                    type="number"
                    value={config[key]}
                    onChange={(e) => set(key, Number(e.target.value))}
                  />
                </label>
              ))}
            </div>
            <label className="field">
              Time zone
              <input
                value={config.timezone}
                onChange={(e) => set("timezone", e.target.value)}
              />
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={config.skip_weekends}
                onChange={(e) => set("skip_weekends", e.target.checked)}
              />
              Keep weekends free
            </label>
            <label className="field">
              Blackout dates (comma separated)
              <input
                value={(config.blackout_dates || []).join(", ")}
                onChange={(e) =>
                  set(
                    "blackout_dates",
                    e.target.value
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean),
                  )
                }
              />
            </label>
          </details>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void create()}
          >
            {busy ? "Working on your plan…" : "Create production plan"}
          </button>
          {!config.region && (
            <p className="hint">
              Add a filming region when you want location research.
            </p>
          )}
        </section>
        <section className="panel">
          <h2>Your plan</h2>
          {ids.length > 1 && <label className="field">
            Saved version
            <select
              value={plan?.id || ""}
              onChange={(e) =>
                api(path("/api/plan/" + e.target.value))
                  .then(open)
                  .catch((e) => setError(e.message))
              }
            >
              <option value="" disabled>
                Select a plan
              </option>
              {ids.map((id, i) => (
                <option key={id} value={id}>{i === 0 ? "Latest plan" : `Earlier version ${ids.length - i}`}</option>
              ))}
            </select>
          </label>}
          {plan ? (
            <>
              <h3>{plan.title}</h3>
              <p>
                <b>{plan.schedule.shoot_days} shoot days</b> ·{" "}
                {plan.budget.total_high > 0 ? `${plan.budget.currency} ${plan.budget.total_low.toLocaleString()}–${plan.budget.total_high.toLocaleString()}` : "Budget not estimated"}
              </p>
              <p className="hint">Budget estimates need review before booking.</p>
              <details><summary>Plan overview</summary><p>{plan.recommendations.summary}</p></details>
              {plan.warnings.length > 0 && <details><summary>Review notes ({plan.warnings.length})</summary>{plan.warnings.map((w: string, i: number) => (
                <p className="hint" key={i}>
                  {w}
                </p>
              ))}</details>}
              <a className="secondary" href={path(`/export/${plan.id}/schedule.csv`)}>Download schedule</a>
              <details><summary>More downloads & calendar</summary>
              <div className="export-row">
                {[
                  "schedule.csv",
                  "budget.csv",
                  "tasks.csv",
                  "calendar.ics",
                  "call-sheets.txt",
                  "plan.json",
                ].map((k) => (
                  <a
                    className="secondary"
                    key={k}
                    href={path(`/export/${plan.id}/${k}`)}
                  >
                    {{ "schedule.csv": "Schedule", "budget.csv": "Budget", "tasks.csv": "Task list", "calendar.ics": "Calendar file", "call-sheets.txt": "Call sheets", "plan.json": "Full plan data" }[k]}
                  </a>
                ))}
              </div>
              {google ? (
                <button
                  className="secondary"
                  onClick={() =>
                    void api(path("/api/calendar-sync"), {
                      id: plan.id,
                      calendar: "primary",
                    })
                      .then(() =>
                        setStatus(
                          "Tentative events added to your connected calendar.",
                        ),
                      )
                      .catch((e) => setError(e.message))
                  }
                >
                  Add to calendar
                </button>
              ) : (
                <a href="/connections" target="_blank" rel="noreferrer">
                  Connect Google Calendar
                </a>
              )}
              <p className="hint">Calendar events are added as tentative.</p>
              </details>
            </>
          ) : (
            <p className="quiet">
              Create a plan to see your schedule, estimated budget and locations here.
            </p>
          )}
        </section>
      </div>
      {plan && (
        <>
          {plan.schedule.unscheduled.length > 0 && <p className="live-status error">{plan.schedule.unscheduled.length} scenes still need scheduling. Open Schedule & budget to review.</p>}
          <details className="panel workspace-section">
            <summary>Schedule & budget <span>{plan.schedule.shoot_days} shoot days</span></summary>
            <div className="schedule">
              {plan.schedule.events.map((e: any) => (
                <div key={e.scene_id}>
                  <b>{e.summary}</b>
                  <p>
                    {e.start} – {e.end}
                  </p>
                  <small>
                    {e.location} · {e.cast.join(", ")}
                  </small>
                </div>
              ))}
            </div>
            {plan.schedule.unscheduled.length > 0 && (
              <p className="live-status error">
                Unscheduled: {plan.schedule.unscheduled.join(", ")}
              </p>
            )}
            <details>
              <summary>Edit scene timing and budget</summary>
              <div style={{ overflowX: "auto" }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Scene</th>
                      <th>Location</th>
                      <th>Shoot minutes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenes.map((s, i) => (
                      <tr key={s.id}>
                        <td>{s.title}</td>
                        <td>
                          <input
                            aria-label={`${s.title} location`}
                            value={s.location}
                            onChange={(e) =>
                              setScenes((v) =>
                                v.map((x, n) =>
                                  n === i
                                    ? { ...x, location: e.target.value }
                                    : x,
                                ),
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            aria-label={`${s.title} minutes`}
                            value={s.minutes}
                            onChange={(e) =>
                              setScenes((v) =>
                                v.map((x, n) =>
                                  n === i
                                    ? { ...x, minutes: Number(e.target.value) }
                                    : x,
                                ),
                              )
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Budget item</th>
                      <th>Quantity</th>
                      <th>Low rate</th>
                      <th>High rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {budget.map((b, i) => (
                      <tr key={i}>
                        <td>{b.description}</td>
                        {["quantity", "low_rate", "high_rate"].map((k) => (
                          <td key={k}>
                            <input
                              type="number"
                              min={0}
                              aria-label={`${b.description} ${k}`}
                              value={b[k]}
                              onChange={(e) =>
                                setBudget((v) =>
                                  v.map((x, n) =>
                                    n === i
                                      ? { ...x, [k]: Number(e.target.value) }
                                      : x,
                                  ),
                                )
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void recalc()}
              >
                Save revised plan
              </button>
            </details>
          </details>
          <details className="panel production-evidence workspace-section">
            <summary>Locations & next steps <span>{plan.recommendations.locations.length} locations</span></summary>
            {plan.recommendations.locations.map((l: any, i: number) => (
              <article key={i}>
                <h3>{l.name}</h3>
                <p>{l.match}</p>
                <small>
                  {l.verification} · Sources: {l.source_ids.join(", ")}
                </small>
              </article>
            ))}
            <ul>
              {plan.recommendations.next_steps.map((s: string, i: number) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
            {plan.evidence.map((s: any) => (
              <p key={s.id}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.id}: {s.title}
                </a>{" "}
                · {s.evidence_level}
              </p>
            ))}
            <details>
              <summary>Research details</summary>
              <p className="hint">{plan.provider} · {plan.status} · Based on {plan.source_files.join(", ")} · {plan.image_count} visual references</p>
              <pre className="real-output">
                {JSON.stringify(
                  {
                    recommendations: plan.recommendations,
                    assumptions: plan.breakdown.assumptions,
                    missing: plan.breakdown.missing_info,
                    research: plan.research,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </details>
        </>
      )}
    </div>
  )
}
