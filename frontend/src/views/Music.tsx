import { useEffect, useState } from "react"
import { useSavedJob } from "../useSavedJob"
import { api, projectPath } from "../api"
import { useStudio, useDraftState } from "../store"
import { errorText, PageTitle } from "../ui"
import { useMaterials, projectAssets } from "../materials"
import { BrandSpot } from "../brandArt"
import { HelpTip } from '../Guide'
export default function Music({ embedded = false }: { embedded?: boolean }) {
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
  const [providerUnavailable,setProviderUnavailable]=useState(false)
  const [audioState,setAudioState]=useState<Record<string,'ready'|'failed'>>({})
  const [pendingJob, setPendingJob] = useSavedJob("music.pendingJob", ["music"], {
    progress: (j) => { setStatus(j.message); setError("") },
    complete: async () => { await load(); await refresh(); setStatus("Your soundtrack request is saved below.") },
    failed: (message) => { setError(message); setStatus("") },
  })
  const busy = submitting || !!pendingJob
  const selectedModel = models.find((m) => m.id === model)
  const scoreUnavailable = !model || model === "minimax-music3" || selectedModel?.instrumental === false
  const minSeconds=mode==='ambience'?5:selectedModel?.duration?.min || 5
  const maxSeconds=mode==='ambience'?360:selectedModel?.duration?.max || 360
  useEffect(()=>{if(seconds<minSeconds||seconds>maxSeconds)setSeconds(Math.max(minSeconds,Math.min(maxSeconds,seconds)))},[seconds,minSeconds,maxSeconds])
  const path = (p: string) => projectPath(p, project.id)
  const load = async () => {
    const data = await api(path("/api/studio/music"))
    setTracks(projectAssets(data.tracks || [],project.id))
  }
  useEffect(() => {
    let live = true
    setTracks([])
    setAudioState({});setProviderUnavailable(false)
    api(path("/api/studio/music"))
      .then((v) => live && setTracks(projectAssets(v.tracks || [],project.id)))
      .catch((e) => live && setError(e.message))
    api("/api/studio/music/models")
      .then((v) => {
        if (live) {
          const rows = v.data || v.models || []
          setModels(rows)
          setModel((previous) => rows.some((m: any) => m.id === previous) ? previous : rows[0]?.id || "")
        }
      })
      .catch(() => {if(live)setProviderUnavailable(true)})
    const changed = () => { void api(path("/api/studio/music")).then((v) => { if (live) setTracks(projectAssets(v.tracks || [],project.id)); }).catch(() => {}); }
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
        prompt: prompt.trim() || mediaDirection,
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
      {useStory && shown?.writing_signature && shown.writing_signature !== signature && <p className="source-changed">Your writing has changed since this soundtrack. <button disabled={busy} onClick={()=>void create()}>Create an updated soundtrack</button></p>}
      <PageTitle level={embedded ? "h2" : "h1"} title="Soundtracks" text="Describe instruments, pace and mood. Your own direction takes priority." ><HelpTip label="About automatic sound settings">Automatic settings choose sound type and duration from your direction. Turn them off to control those choices. Ambient soundscapes use local synthesis; scores and songs need the connected music provider.</HelpTip></PageTitle>
      {error && <p className="live-status error" role="alert">{error}</p>}
      {status && <p className="live-status" role="status">{status}</p>}
      {providerUnavailable && <p className="hint" role="status">Music generation isn't available in this studio yet. Your saved tracks are still available below.</p>}
      <div className="creative-layout">
        <section className="panel composer">
          <h2>Create a soundtrack</h2>
          <label className="field">Describe the sound<textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={4000} placeholder="Soft piano, an uneasy pulse, distant forest sounds… or leave it to us." /></label>
          <label className="inline-suggestion"><input type="checkbox" checked={useStory} onChange={(e) => setUseStory(e.target.checked)} />Use {sourceTitle}</label>
          <label className="inline-suggestion"><input type="checkbox" checked={automatic} onChange={(e) => setAutomatic(e.target.checked)} />Choose sound and settings for me</label>
          <details className="workspace-options"><summary>Sound settings{automatic ? " · automatic" : ""}</summary>
          <p className="hint">{automatic ? 'Turn off automatic settings to use your choices below.' : 'Choose the sound type and duration below.'}</p>
          <label className="field">Sound type
            <select disabled={automatic||busy} value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="ambience">Ambient soundscape</option>
              <option value="score" disabled={scoreUnavailable}>Cinematic score{scoreUnavailable ? " · provider needed" : ""}</option>
              <option value="song">Song with lyrics</option>
            </select>
          </label>
          {scoreUnavailable && <p className="hint">The connected provider does not support instrumental scores. You can create nature sounds locally or choose a song with lyrics.</p>}
          <label className="field">{mode!=='ambience'&&selectedModel?.duration?.semantics==='max'?'Maximum duration':'Duration'} · {seconds} seconds
            <input disabled={automatic||busy} type="range" min={minSeconds} max={maxSeconds} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} />
          </label>
          {mode === "song" && <label className="field">Lyrics<textarea className="tall" value={lyrics} onChange={(e) => setLyrics(e.target.value)} maxLength={12000} placeholder="Add the words for your song" /></label>}
          {mode !== "ambience" && <>
            {!model && <p className="hint">Connect a music provider in Connections to create scores and songs.</p>}
            <label className="field">Music model<select disabled={automatic||busy} value={model} onChange={(e) => setModel(e.target.value)}>{models.map((m) => <option value={m.id} key={m.id}>{m.name || m.id}</option>)}</select></label><p className="hint">Scores and songs use your connected music provider.</p>
          </>}
          </details>
          <button className="primary" disabled={busy || providerUnavailable && (automatic || mode!=='ambience') || (!useStory && !prompt.trim()) || (!automatic && ((mode !== "ambience" && !model) || (mode === "score" && scoreUnavailable) || (mode === "song" && !lyrics.trim())))} onClick={() => void create()}>{busy ? "Preparing…" : automatic ? "Create soundtrack for me" : "Create soundtrack"}</button>
          <p className="hint">Your soundtrack uses the selected writing and your prompt. You can keep writing while it generates.</p>
        </section>
        <section className="results" aria-label="Saved soundtracks">
          <div className="workspace-result-head"><h2>Your soundtrack</h2><button className="text-action" onClick={() => void load().catch((e) => setError(e.message))}>Refresh</button></div>
          {tracks.length > 1 && <label className="field history-picker">Saved tracks<select value={shown?.job.id || ""} onChange={(e) => setSelectedTrack(e.target.value)}>{tracks.map((t, i) => <option key={t.job.id} value={t.job.id}>{i === 0 ? "Latest" : `Earlier ${tracks.length - i}`} · {trackName(t)} · {t.job.status}</option>)}</select></label>}
          {(shown ? [shown] : []).map((t) => <article className="panel result" key={t.job.id}>
            <div className="finding-head"><h3>{trackName(t)}</h3><small role="status">{audioState[t.job.id]==='failed'?"Couldn't load this track":t.job.status === "completed" ? audioState[t.job.id]==='ready'?"Ready to play":"Loading audio…" : t.job.status}</small></div>
            {!["failed", "cancelled", "expired"].includes(t.job.status) && audioState[t.job.id]!=='failed' && <audio controls preload="metadata" onLoadedMetadata={()=>setAudioState(state=>({...state,[t.job.id]:'ready'}))} onError={()=>setAudioState(state=>({...state,[t.job.id]:'failed'}))} src={path(`/media/music/${t.job.id}/${t.job.status === "completed" ? "content" : "stream"}`)} />}
            {audioState[t.job.id]==='failed' && <button className="text-action" onClick={()=>setAudioState(state=>{const next={...state};delete next[t.job.id];return next})}>Retry audio</button>}
            <div className="comment-actions">
              {t.job.status === "completed" ? audioState[t.job.id]==='ready' && <><button onClick={() => void action(t.job.id, "save")}>Save audio</button><a href={path(`/media/music/${t.job.id}/content`)} download>Download audio</a></> : !["failed", "cancelled", "expired"].includes(t.job.status) && <button onClick={() => void action(t.job.id, "cancel")}>Cancel generation</button>}
            </div>
            {t.job.error && <p role="alert">{errorText(t.job.error.message || t.job.error)}</p>}
            <details><summary>Track details</summary><p>{t.cue.prompt}</p><small>{t.settings?.seconds ? `${t.settings.seconds} seconds · ` : ""}{t.source_title ? `${t.source_title} · ` : ""}{t.provider || t.job.model || "Saved audio"} · {t.cue.sources?.join(", ")}</small></details>
          </article>)}
          {!tracks.length && <div className="empty illustrated-empty music-empty"><BrandSpot kind="music" /><div className="empty-copy"><h3>Give your story a sound.</h3><p>Create a soundtrack to listen to it here.</p></div></div>}
          {tracks.length > 0 && <button className="text-action workspace-next" onClick={() => go("production")}>Next: plan production →</button>}
        </section>
      </div>
    </div>
  )
}
