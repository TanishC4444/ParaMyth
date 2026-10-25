import { useEffect, useState } from "react"
import { api, projectPath, waitJob } from "../api"
import { useStudio } from "../store"
import { PageTitle } from "../ui"
import { Artwork } from "../art"
export default function Music() {
  const { project, mediaDirection, flush, refresh, go } = useStudio()
  const [mode, setMode] = useState("ambience"),
    [seconds, setSeconds] = useState(30),
    [lyrics, setLyrics] = useState(""),
    [model, setModel] = useState(""),
    [models, setModels] = useState<any[]>([]),
    [tracks, setTracks] = useState<any[]>([]),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false)
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
          setModel(rows[0]?.id || "")
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
    setBusy(true)
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
      await refresh()
      await waitJob(q.job_id, (j) => setStatus(j.message))
      await load()
      await refresh()
      setStatus("Your soundtrack request is saved below.")
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
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
  return (
    <div className="page">
      <PageTitle
        eyebrow="FIND ITS RHYTHM"
        title="Soundtracks"
        text="Create environmental sound, a cinematic score, or a song from the same story and scene."
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
      <div className="creative-layout">
        <section className="panel">
          <label className="field">
            Sound for your scene
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="ambience">
                Ambient soundscape · studio synthesis
              </option>
              <option value="score">Cinematic score · Vultr</option>
              <option value="song">Song · Vultr</option>
            </select>
          </label>
          <label className="field">
            Duration · {seconds} seconds
            <input
              type="range"
              min={5}
              max={360}
              value={seconds}
              onChange={(e) => setSeconds(Number(e.target.value))}
            />
          </label>
          {mode !== "ambience" && (
            <label className="field">
              Music model
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.name || m.id}
                  </option>
                ))}
              </select>
            </label>
          )}
          {mode === "song" && (
            <label className="field">
              Lyrics
              <textarea
                className="tall"
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                maxLength={12000}
              />
            </label>
          )}
          <button
            className="primary"
            disabled={
              busy ||
              (mode !== "ambience" && !model) ||
              (mode === "song" && !lyrics.trim())
            }
            onClick={() => void create()}
          >
            {busy ? "Preparing…" : "Create soundtrack"}
          </button>
          <p className="hint">
            Your story provides the context. Adjust the shared creative
            direction above to focus the sound.
          </p>
        </section>
        <section className="results">
          <button
            className="text-action"
            onClick={() => void load().catch((e) => setError(e.message))}
          >
            Refresh saved tracks
          </button>
          {tracks.map((t) => (
            <article className="panel result" key={t.job.id}>
              <h3>
                {t.cue.mode === "ambience"
                  ? "Ambient soundscape"
                  : t.cue.mode === "song"
                    ? "Song"
                    : "Cinematic score"}
              </h3>
              <p>
                {t.provider || t.job.model || 'Saved audio'} · {t.job.status}
              </p>
              {!["failed", "cancelled", "expired"].includes(t.job.status) && (
                <audio
                  controls
                  preload="none"
                  src={path(
                    `/media/music/${t.job.id}/${
                      t.job.status === "completed" ? "content" : "stream"
                    }`,
                  )}
                />
              )}
              <details>
                <summary>Story cues and sources</summary>
                <p>{t.cue.prompt}</p>
                <small>{t.cue.sources?.join(", ")}</small>
              </details>
              <div className="comment-actions">
                {t.job.status === "completed" ? (
                  <>
                    <button onClick={() => void action(t.job.id, "save")}>
                      Save audio to project
                    </button>
                    <a href={path(`/media/music/${t.job.id}/content`)} download>
                      Download audio
                    </a>
                  </>
                ) : (
                  !["failed", "cancelled", "expired"].includes(
                    t.job.status,
                  ) && (
                    <button onClick={() => void action(t.job.id, "cancel")}>
                      Cancel generation
                    </button>
                  )
                )}
                <button onClick={() => go("production")}>
                  Continue to production
                </button>
              </div>
              {t.job.error && (
                <p role="alert">{String(t.job.error.message || t.job.error)}</p>
              )}
            </article>
          ))}
          {!tracks.length && (
            <div className="empty illustrated-empty music-empty">
              <Artwork name="music" />
              <div className="empty-copy">
                <span className="eyebrow">THE SOUND OF YOUR STORY</span>
                <h3>Set the scene. Find its rhythm.</h3>
                <p>
                  Soundtracks and their story cues stay together in your
                  project.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
