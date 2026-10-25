import { useEffect, useState } from "react"
import { useSavedJob } from "../useSavedJob"
import { api, projectPath } from "../api"
import { useStudio, useDraftState } from "../store"
import { PageTitle } from "../ui"
import { Artwork } from "../art"
export default function Music() {
  const { project, mediaDirection, flush, refresh, go } = useStudio()
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
    failed: setError,
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
    return () => {
      live = false
    }
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
        if (live)
          setTracks((prev) =>
            prev.map((t) => values.find((v) => v.job.id === t.job.id) || t),
          )
      } catch (e) {
        if (live) setError(String(e))
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
      const q = await api(path("/api/studio/music"), {
        mode,
        seconds,
        direction: mediaDirection,
        model,
        lyrics,
      })
      setPendingJob({ id: q.job_id, kind: "music" })
      await refresh()
    } catch (e) {
      setError(String(e))
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
      setError(String(e))
    }
  }
  const shown = tracks.find((t) => t.job.id === selectedTrack) || tracks[0]
  const trackName = (t: any) => t.cue.mode === "ambience" ? "Ambient soundscape" : t.cue.mode === "song" ? "Song" : "Cinematic score"
  return (
    <div className="page simple-workspace">
      <PageTitle eyebrow="" title="Soundtracks" text="Choose a sound. Your story sets the mood." />
      {error && <p className="live-status error" role="alert">{error}</p>}
      {status && <p className="live-status" role="status">{status}</p>}
      <div className="creative-layout">
        <section className="panel composer">
          <h2>Create a soundtrack</h2>
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
          <button className="primary" disabled={busy || (mode !== "ambience" && !model) || (mode === "song" && !lyrics.trim())} onClick={() => void create()}>{busy ? "Preparing…" : "Create soundtrack"}</button>
          <p className="hint">Uses your story{mediaDirection ? " and chosen direction" : ""}. Adjust Scene & direction above for a specific mood.</p>
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
            <details><summary>Track details</summary><p>{t.cue.prompt}</p><small>{t.provider || t.job.model || "Saved audio"} · {t.cue.sources?.join(", ")}</small></details>
          </article>)}
          {!tracks.length && <div className="empty illustrated-empty music-empty"><Artwork name="music" /><div className="empty-copy"><h3>Give your story a sound.</h3><p>Create a soundtrack to listen to it here.</p></div></div>}
          {tracks.length > 0 && <button className="text-action workspace-next" onClick={() => go("production")}>Next: plan production →</button>}
        </section>
      </div>
    </div>
  )
}
