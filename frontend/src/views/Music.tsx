import { useEffect, useState } from "react"
import { useSavedJob } from "../useSavedJob"
import { api, projectPath } from "../api"
import { useStudio, useDraftState } from "../store"
import { errorText, PageTitle } from "../ui"
import { useMaterials } from "../materials"
import { BrandSpot } from "../brandArt"
export default function Music() {
  const { project, mediaDirection, flush, refresh, go } = useStudio()
  const { source, sourceTitle, signature, streaming } = useMaterials()
  const [prompt, setPrompt] = useDraftState("music.prompt", "")
  const [automatic, setAutomatic] = useDraftState("music.automatic", true)
  const [useStory, setUseStory] = useDraftState("music.useStory", true)
  const [mode, setMode] = useDraftState("music.mode", "ambience"),
    [seconds, setSeconds] = useDraftState("music.seconds", 30),
    [lyrics, setLyrics] = useDraftState("music.lyrics", ""),
    [model, setModel] = useDraftState("music.model", ""),
    [models, setModels] = useState<any[]>([]),
    [tracks, setTracks] = useState<any[]>([]),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [submitting, setSubmitting] = useState(false)
  const [selectedTrack, setSelectedTrack] = useDraftState("music.selectedTrack", "")
  const [pendingJob, setPendingJob] = useSavedJob("music.pendingJob", ["music"], {
    progress: (j) => { setStatus(j.message); setError("") },
    complete: async () => { await load(); await refresh(); setStatus("Your soundtrack request is saved below.") },
    failed: (message) => { setError(message); setStatus("") },
  })
  const busy = submitting || !!pendingJob
  const path = (p: string) => projectPath(p, project.id)
  const load = async () => {
    const data = await api(path("/api/studio/music"))
    setTracks(data.tracks)
  }
  useEffect(() => {
    let live = true
    setTracks([])
    api(path("/api/studio/music"))
      .then((v) => live && setTracks(v.tracks))
      .catch((e) => live && setError(e.message))
    api("/api/studio/music/models")
      .then((v) => {
        if (live) {
          const rows = v.data || v.models || []
          setModels(rows)
          setModel((previous) => rows.some((m: any) => m.id === previous) ? previous : rows[0]?.id || "")
        }
      })
      .catch((e) => live && setError(e.message))
    const changed = () => { void api(path("/api/studio/music")).then((v) => { if (live) setTracks(v.tracks); }).catch(() => {}); }
    window.addEventListener("studio-refresh", changed)
    window.addEventListener("studio-shared-update", changed)
    return () => { live = false; window.removeEventListener("studio-refresh", changed); window.removeEventListener("studio-shared-update", changed) }
  }, [project.id])
  useEffect(() => {
    const active = tracks.filter(
      (t) =>
        !["completed", "failed", "cancelled", "expired"].includes(t.job.status),
    )
    if (!active.length) return
    let live = true
    const timer = setInterval(async () => {
      try {
        const values = await Promise.all(
          active.map((t) => api(path("/api/studio/music/" + t.job.id))),
        )
        if (live && values.some((v) => ["completed", "failed", "cancelled", "expired"].includes(v.job.status))) window.dispatchEvent(new Event("studio-refresh"))
        if (live)
          setTracks((prev) =>
            prev.map((t) => values.find((v) => v.job.id === t.job.id) || t),
          )
      } catch (e) {
        if (live) setError(errorText(e))
      }
    }, 6000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [tracks, project.id])
  const create = async () => {
    setSubmitting(true)
    setSelectedTrack("")
    setError("")
    try {
      await flush()
      const q = await api(path("/api/ui/music"), {
        mode,
        seconds,
        prompt: [prompt, mediaDirection].filter(Boolean).join("\n"),
        source, use_story: useStory, automatic,
        model,
        lyrics,
      })
      setPendingJob({ id: q.job_id, kind: "music", local: q.local })
      await refresh()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSubmitting(false)
    }
  }
  const action = async (id: string, name: string) => {
    try {
      const r = await api(path(`/api/studio/music/${id}/${name}`), {})
      setStatus(
        name === "save"
          ? "Audio saved to your project."
          : "Cancellation requested.",
      )
      await load()
    } catch (e) {
      setError(errorText(e))
    }
  }
  const shown = tracks.find((t) => t.job.id === selectedTrack) || tracks[0]
  const trackName = (t: any) => t.cue.mode === "ambience" ? "Ambient soundscape" : t.cue.mode === "song" ? "Song" : "Cinematic score"
  return (
    <div className="page simple-workspace">
      {streaming && <p className="hint" role="status">Following the live draft. New soundtracks use its current mood and story details.</p>}
      {shown?.writing_signature && shown.writing_signature !== signature && <p className="source-changed">Your writing has changed since this soundtrack. <button disabled={busy} onClick={()=>void create()}>Create an updated soundtrack</button></p>}
      <PageTitle title="Soundtracks" text="Choose a sound. Your story sets the mood." />
      {error && <p className="live-status error" role="alert">{error}</p>}
      {status && <p className="live-status" role="status">{status}</p>}
      <div className="creative-layout">
        <section className="panel composer">
          <h2>Create a soundtrack</h2>
          <label className="field">Describe the sound<textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={4000} placeholder="Soft piano, an uneasy pulse, distant forest sounds… or leave it to us." /></label>
          <label className="inline-suggestion"><input type="checkbox" checked={useStory} onChange={(e) => setUseStory(e.target.checked)} />Use {sourceTitle}</label>
          <label className="inline-suggestion"><input type="checkbox" checked={automatic} onChange={(e) => setAutomatic(e.target.checked)} />Choose sound and settings for me</label>
          <details className="workspace-options"><summary>Sound settings{automatic ? " · automatic" : ""}</summary>
          <p className="hint">Turn off automatic settings to use your choices below.</p>
          <label className="field">Sound type
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="ambience">Ambient soundscape</option>
              <option value="score">Cinematic score</option>
              <option value="song">Song with lyrics</option>
            </select>
          </label>
          <label className="field">Duration · {seconds} seconds
            <input type="range" min={5} max={360} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} />
          </label>
          {mode === "song" && <label className="field">Lyrics<textarea className="tall" value={lyrics} onChange={(e) => setLyrics(e.target.value)} maxLength={12000} placeholder="Add the words for your song" /></label>}
          {mode !== "ambience" && <>
            {!model && <p className="hint">Connect a music provider in Connections to create scores and songs.</p>}
            <details className="workspace-options"><summary>Sound settings</summary><label className="field">Music model<select value={model} onChange={(e) => setModel(e.target.value)}>{models.map((m) => <option value={m.id} key={m.id}>{m.name || m.id}</option>)}</select></label><p className="hint">Scores and songs use your connected music provider.</p></details>
          </>}
          </details>
          <button className="primary" disabled={busy || (!useStory && !prompt.trim()) || (!automatic && ((mode !== "ambience" && !model) || (mode === "song" && !lyrics.trim())))} onClick={() => void create()}>{busy ? "Preparing…" : automatic ? "Create soundtrack for me" : "Create soundtrack"}</button>
          <p className="hint">Your soundtrack uses the selected writing and your prompt. You can keep writing while it generates.</p>
        </section>
        <section className="results" aria-label="Saved soundtracks">
          <div className="workspace-result-head"><h2>Your soundtrack</h2><button className="text-action" onClick={() => void load().catch((e) => setError(e.message))}>Refresh</button></div>
          {tracks.length > 1 && <label className="field history-picker">Saved tracks<select value={shown?.job.id || ""} onChange={(e) => setSelectedTrack(e.target.value)}>{tracks.map((t, i) => <option key={t.job.id} value={t.job.id}>{i === 0 ? "Latest" : `Earlier ${tracks.length - i}`} · {trackName(t)} · {t.job.status}</option>)}</select></label>}
          {(shown ? [shown] : []).map((t) => <article className="panel result" key={t.job.id}>
            <div className="finding-head"><h3>{trackName(t)}</h3><small>{t.job.status === "completed" ? "Ready to play" : t.job.status}</small></div>
            {!["failed", "cancelled", "expired"].includes(t.job.status) && <audio controls preload="none" src={path(`/media/music/${t.job.id}/${t.job.status === "completed" ? "content" : "stream"}`)} />}
            <div className="comment-actions">
              {t.job.status === "completed" ? <><button onClick={() => void action(t.job.id, "save")}>Save audio</button><a href={path(`/media/music/${t.job.id}/content`)} download>Download audio</a></> : !["failed", "cancelled", "expired"].includes(t.job.status) && <button onClick={() => void action(t.job.id, "cancel")}>Cancel generation</button>}
            </div>
            {t.job.error && <p role="alert">{String(t.job.error.message || t.job.error)}</p>}
            <details><summary>Track details</summary><p>{t.cue.prompt}</p><small>{t.settings?.seconds ? `${t.settings.seconds} seconds · ` : ""}{t.source_title ? `${t.source_title} · ` : ""}{t.provider || t.job.model || "Saved audio"} · {t.cue.sources?.join(", ")}</small></details>
          </article>)}
          {!tracks.length && <div className="empty illustrated-empty music-empty"><BrandSpot kind="music" /><div className="empty-copy"><h3>Give your story a sound.</h3><p>Create a soundtrack to listen to it here.</p></div></div>}
          {tracks.length > 0 && <button className="text-action workspace-next" onClick={() => go("production")}>Next: plan production →</button>}
        </section>
      </div>
    </div>
  )
}
