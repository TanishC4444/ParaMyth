import { useEffect, useState } from "react"
import { useSavedJob } from "../useSavedJob"
import { api, projectPath } from "../api"
import { useStudio, useDraftState } from "../store"
import { useMaterials } from "../materials"
import { errorText, PageTitle } from "../ui"
import { HelpTip } from '../Guide'
export default function Production({ embedded = false }: { embedded?: boolean }) {
  const { project, mediaDirection, flush, refresh, setDraft, go } = useStudio()
  const { source, sourceId, sourceTitle, signature, streaming, images: availableImages, tracks: availableTracks, setSource } = useMaterials()
  const [prompt, setPrompt] = useDraftState("production.prompt", "")
  const [useStory, setUseStory] = useDraftState("production.useStory", true)
  const [imageIds, setImageIds] = useDraftState<string[]>("production.imageIds", [])
  const [trackIds, setTrackIds] = useDraftState<string[]>("production.trackIds", [])
  const [automaticAssets, setAutomaticAssets] = useDraftState("production.automaticAssets", true)
  const [starter, setStarter] = useDraftState<any>("production.starter", null)
  const [showHistory, setShowHistory] = useState(false)
  const [config, setConfig] = useDraftState<any>("production.config", {
    region: "",
    auto_region: true,
    start_date: new Date().toISOString().slice(0, 10),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    currency: "USD",
    day_hours: 10,
    setup_minutes: 30,
    move_minutes: 45,
    contingency: 15,
    budget_cap: 0,
    search_limit: 8,
    detailed: true,
    auto_settings: true,
    skip_weekends: true,
  })
  const [savedPlan, setPlan] = useDraftState<any>("production.plan", null),
    [ids, setIds] = useState<string[]>([]),
    [submitting, setSubmitting] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [scenes, setScenes] = useDraftState<any[]>("production.scenes", []),
    [budget, setBudget] = useDraftState<any[]>("production.budget", []),
    [google, setGoogle] = useState(false)
  const [pendingJob, setPendingJob] = useSavedJob("production.pendingJob", ["production", "production-brief"], {
    progress: (j) => { setStatus(j.message); setError("") },
    complete: async (j) => {
      if (j.kind === "production-brief") {
        setStarter(j.result); setPrompt(j.result.brief); setConfig((c:any) => ({...c,region:c.region || j.result.region}));
        setStatus("Direction and prompts are ready. Edit anything, then create your plan."); await refresh(); return;
      }
      open(j.result)
      setShowHistory(false)
      setIds((v) => [j.result.id, ...v.filter((x) => x !== j.result.id)])
      setStatus("Your production plan is ready.")
      await refresh()
    },
    failed: (message) => { setError(message); setStatus("") },
  })
  const plan = savedPlan
  const prompts = starter?.source_id === sourceId ? starter : plan?.starter
  const changed = !!plan && useStory && (plan.source_id !== sourceId || !!plan.writing_signature && plan.writing_signature !== signature)
  const settingsChanged=!!plan && JSON.stringify(config)!==JSON.stringify(plan.config)
  useEffect(() => { setShowHistory(false) }, [sourceId, useStory])
  const busy = submitting || !!pendingJob
  const path = (p: string) => projectPath(p, project.id)
  const open = (p: any) => {
    setPlan(p)
    setShowHistory(true)
    setConfig(p.config)
    setScenes(p.breakdown.scenes)
    setBudget(p.breakdown.budget_items)
  }
  useEffect(()=>{
    let live=true
    const load=()=>api(path('/api/config')).then(c=>{if(live){setIds(c.plans);setGoogle(c.google)}}).catch(()=>{})
    window.addEventListener('studio-shared-update',load)
    return()=>{live=false;window.removeEventListener('studio-shared-update',load)}
  },[project.id])
  useEffect(() => {
    let live = true
    api(path("/api/config"))
      .then(async (c) => {
        if (!live) return
        setIds(c.plans)
        setGoogle(c.google)
        if (c.plans.length && !plan) {
          const p = await api(path("/api/plan/" + c.plans[0]))
          if (live && p.source_id === sourceId) { setPlan(p); if (!scenes.length) setScenes(p.breakdown.scenes); if (!budget.length) setBudget(p.breakdown.budget_items); }
        }
      })
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [project.id, sourceId])
  const create = async (prepare = false) => {
    setSubmitting(true)
    setError("")
    try {
      await flush()
      const q = await api(path(prepare ? "/api/ui/production/prepare" : "/api/ui/production"), {
        config: {...config,detailed:true,auto_settings:config.auto_settings !== false,auto_region:config.auto_region !== false}, prompt: prompt.trim() || mediaDirection,
        source, use_story: useStory, image_ids: imageIds, track_ids: trackIds, automatic_assets: automaticAssets,
      })
      setPendingJob({ id: q.job_id, kind: prepare ? "production-brief" : "production", local: q.local })
      await refresh()
    } catch (e) {
      setError(errorText(e))
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
      setError(errorText(e))
    } finally {
      setSubmitting(false)
    }
  }
  const set = (k: string, v: any) => setConfig((c: any) => ({ ...c, [k]: v,locked_settings:[...new Set([...(c.locked_settings || []),...(['region','start_date','timezone','currency','day_hours','setup_minutes','move_minutes','contingency','budget_cap','search_limit','skip_weekends','crew_size'].includes(k)?[k]:[])])] }))
  return (
    <div className="page simple-workspace">
      <PageTitle level={embedded ? "h2" : "h1"}
        title="Production"
        text="Turn your story into a shoot schedule, budget and location plan."
      ><HelpTip label="How production planning works">Your connected model reasons about the shoot. SerpAPI supplies real-world research leads. Automatic planning fills unspecified choices and keeps settings you enter. Estimates and search leads need confirmation before booking.</HelpTip></PageTitle>
      {changed && <p className="source-changed">Your writing has changed since this plan. <button disabled={busy} onClick={() => void create()}>Update from current writing</button></p>}
      {settingsChanged && <p className="source-changed">Your settings have changed. Create a new plan, or recalculate the schedule and budget below.</p>}
      {streaming && <p className="hint" role="status">Following the live draft. Creating a plan uses the words available when you start.</p>}
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
          <fieldset className="production-form" disabled={busy}>
          <label className="field">What do you want to make?<textarea disabled={busy} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={6000} placeholder="Leave this blank and we’ll propose the approach, locations and practical details from your story." /></label>
          <details className="workspace-options"><summary>Explore a direction first</summary><p className="hint">Optional: review a proposed approach before creating the full plan.</p><button className="secondary" disabled={busy || (!useStory && !prompt.trim())} onClick={() => void create(true)}>Suggest direction & prompts</button></details>
          <label className="inline-suggestion"><input type="checkbox" checked={useStory} onChange={(e) => setUseStory(e.target.checked)} />Use {sourceTitle}</label>
          <label className="inline-suggestion"><input type="checkbox" checked={automaticAssets} onChange={e => setAutomaticAssets(e.target.checked)} />Include latest visuals and soundtracks automatically</label>
          <details className="workspace-options"><summary>Include generated visuals · {automaticAssets?Math.min(3,availableImages.length):imageIds.filter(id=>availableImages.some(image=>image.id===id)).length} selected</summary>
            <p className="hint">{automaticAssets ? 'The three latest finished visuals will be included. Turn off automatic selection to choose specific ones.' : 'Choose up to three visuals. New images appear here when they finish.'}</p>
            <div className="reference-picker">{availableImages.map((image) => <label key={image.id}>
              <img src={path(`/media/images/${image.id}/0.png`)} alt={image.title} loading="lazy" />
              <span><input type="checkbox" checked={imageIds.includes(image.id)} disabled={!imageIds.includes(image.id) && imageIds.length >= 3} onChange={(e) => setImageIds((v) => e.target.checked ? [...v, image.id] : v.filter((id) => id !== image.id))} />{image.title}</span>
            </label>)}</div>
            {!availableImages.length && <p className="hint">Generate an image in Visuals to use it here.</p>}
          </details>
          <details className="workspace-options"><summary>Include soundtrack direction · {automaticAssets?Math.min(3,availableTracks.length):trackIds.filter(id=>availableTracks.some(track=>track.id===id)).length} selected</summary>
            <p className="hint">Bring the mood and sound choices into your plan.</p>
            {availableTracks.map((track) => <label className="toggle" key={track.id}><input type="checkbox" checked={trackIds.includes(track.id)} disabled={!trackIds.includes(track.id) && trackIds.length >= 3} onChange={(e) => setTrackIds((v) => e.target.checked ? [...v, track.id] : v.filter((id) => id !== track.id))} />{track.title} · {track.mode}</label>)}
            {!availableTracks.length && <p className="hint">Finished soundtracks appear here automatically.</p>}
          </details>
          <div className="form-grid">
            <label className="field">
              Filming region
              <input
                value={config.region}
                onChange={(e) => set("region", e.target.value)}
                placeholder="Leave blank and we’ll propose a region"
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
          <details className="workspace-options"><summary>Budget settings</summary>
            <label className="toggle"><input type="checkbox" checked={config.local_crew ?? /\blocal crew\b|\bno (?:hotels?|lodging|accommodation)\b/i.test(prompt)} onChange={e=>setConfig((value:any)=>({...value,local_crew:e.target.checked}))}/>Crew is local; no accommodation or flights needed</label>
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
          </details>
          <details>
            <summary>Schedule settings</summary>
            <label className="toggle"><input type="checkbox" checked={config.auto_settings!==false} onChange={e=>setConfig((value:any)=>({...value,auto_settings:e.target.checked}))}/>Choose unspecified schedule and budget settings for me</label>
            <div className="form-grid">
              {[
                ["day_hours", "Workday hours"],
                ["setup_minutes", "Setup minutes"],
                ["move_minutes", "Move minutes"],
                ["contingency", "Contingency %"],
                ["search_limit", "Research searches (0–12)"],
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
            disabled={busy || (!useStory && !prompt.trim())}
            onClick={() => void create()}
          >
            {busy ? "Working on your plan…" : "Create production plan"}
          </button>
          {!config.region && (
            <p className="hint">
              We’ll propose a filming region and research it. You can change it before making any arrangements.
            </p>
          )}
          </fieldset>
        </section>
        <section className="panel">
          <h2>Your plan</h2>
          {ids.length > 0 && <label className="field">
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
              <p className="hint">Based on {plan.source_title || "earlier saved writing"}{plan.image_count ? ` · ${plan.image_count} visual references` : ""}</p>
              <p>
                <b>{plan.schedule.shoot_days} shoot days</b> ·{" "}
                {plan.budget.total_high > 0 ? `${plan.budget.unknown_costs?.length?'Priced costs only: ':''}${plan.budget.currency} ${plan.budget.total_low.toLocaleString()}–${plan.budget.total_high.toLocaleString()}` : "Budget not estimated"}
              </p>
              <p className="hint">{plan.budget.unknown_costs?.length ? `Budget incomplete: ${plan.budget.unknown_costs.length} items still need rates. The displayed range excludes these costs and does not establish affordability.` : 'Budget estimates need review before booking.'}</p>
              {!!plan.budget.unknown_costs?.length && <details><summary>Costs still to price</summary><ul>{plan.budget.unknown_costs.map((item:string)=><li key={item}>{item}</li>)}</ul></details>}
              <p className="production-plan-summary">{plan.recommendations.summary}</p>
              <h3>Start here</h3><ol className="production-steps">{plan.recommendations.next_steps.slice(0,5).map((step:string,i:number)=><li key={i}>{step}</li>)}</ol>
              <h3>Location leads · {plan.config.region || 'Region undecided'}</h3>
              {plan.recommendations.locations.slice(0,3).map((place:any,i:number)=><article className="production-location" key={i}><b>{place.name}</b><p>{place.match}</p>{place.source_ids.map((id:string)=>{const evidence=plan.evidence.find((e:any)=>e.id===id);return evidence?<a key={id} href={evidence.url} target="_blank" rel="noreferrer">{evidence.title} ↗ </a>:null;})}<small>{(place.unknowns || []).join(' · ')}</small></article>)}
              <details><summary>Crew, equipment & practical tasks</summary><ul>{plan.recommendations.crew_equipment.map((item:string,i:number)=><li key={i}>{item}</li>)}</ul>{plan.recommendations.legal_logistics.map((item:any,i:number)=><p key={i}><b>{item.owner}</b> · {item.task}</p>)}</details>
              <details><summary>Planning assumptions</summary><ul>{[...(plan.starter?.assumptions || []),...plan.breakdown.assumptions,...plan.breakdown.missing_info].map((item:string,i:number)=><li key={i}>{item}</li>)}</ul></details>
              {plan.warnings.length > 0 && <details><summary>Review notes ({plan.warnings.length})</summary>{plan.warnings.map((w: string, i: number) => (
                <p className="hint" key={i}>
                  {w}
                </p>
              ))}</details>}
              <div className="comment-actions"><a className="secondary" href={path(`/export/${plan.id}/plan.pdf`)}>Download plan PDF</a><a className="secondary" href={path(`/export/${plan.id}/plan.docx`)}>Download plan Word</a></div>
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
      {prompts && <details className="panel production-prompt-picks"><summary>Suggested visual & soundtrack prompts</summary><p>{prompts.reason}</p>{prompts.image_prompts.map((item:any,i:number)=><article key={i}><b>{item.title}</b><p>{item.prompt}</p><button onClick={()=>{setDraft(project.id,'images.prompt',item.prompt);setDraft(project.id,'images.subject',item.title);setDraft(project.id,'images.provenance',null);go('images');}}>Use in Visuals</button></article>)}<article><b>Soundtrack direction</b><p>{prompts.sound_prompt}</p><button onClick={()=>{setDraft(project.id,'music.prompt',prompts.sound_prompt);go('music');}}>Use in Soundtracks</button></article></details>}
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
