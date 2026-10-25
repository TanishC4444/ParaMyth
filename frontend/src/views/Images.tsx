import { useEffect, useState } from "react"
import { api, projectPath, waitJob } from "../api"
import { useStudio } from "../store"
import { PageTitle } from "../ui"
import { Artwork } from "../art"
export default function Images() {
  const { project, flush, refresh, go, setMediaDirection, mediaDirection } =
    useStudio()
  const [models, setModels] = useState<any[]>([]),
    [model, setModel] = useState(""),
    [images, setImages] = useState<any[]>([]),
    [kind, setKind] = useState("scene"),
    [subject, setSubject] = useState(""),
    [style, setStyle] = useState("Auto - match story"),
    [shape, setShape] = useState(""),
    [resolution, setResolution] = useState(""),
    [prompt, setPrompt] = useState(""),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [enhance, setEnhance] = useState(true),
    [backup, setBackup] = useState(true),
    [provenance, setProvenance] = useState<any>(null)
  const path = (p: string) => projectPath(p, project.id)
  const load = async () => setImages((await api(path("/api/images"))).images)
  useEffect(() => {
    let live = true
    setImages([])
    api(path("/api/images"))
      .then((v) => live && setImages(v.images))
      .catch((e) => live && setError(e.message))
    api("/api/images/models")
      .then((v) => {
        if (live) {
          setModels(v.models)
          setModel(v.models[0]?.id || "")
        }
      })
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [project.id])
  const useImage=async(img:any,destination:'prompt'|'production'|'music')=>{
    try{
      const record=await api(path('/api/images/'+img.id));
      if(destination==='prompt'){setPrompt(record.request.prompt);setProvenance({prompt_provider:record.provider,sources:[],assumptions:record.fallback?[record.fallback.reason]:[]});return}
      if(destination==='production')sessionStorage.setItem('paramyth-scout-'+project.id,img.id);
      setMediaDirection(img.title+': '+record.request.prompt.slice(0,650));go(destination);
    }catch(e){setError(String(e))}
  };
  const selected = models.find((x) => x.id === model),
    params = selected?.supported_parameters || {},
    shapes = params.aspect_ratio?.values || [],
    resolutions = params.resolution?.values || []
  useEffect(() => {
    setShape(shapes.includes("16:9") ? "16:9" : shapes[0] || "")
    setResolution(resolutions[0] || "")
  }, [model, models])
  const submit = async (generate: boolean) => {
    setBusy(true)
    setError("")
    try {
      await flush()
      const body = generate
        ? {
            model,
            prompt,
            aspect_ratio: shape,
            resolution,
            n: 1,
            kind,
            title: subject || kind,
            allow_backup: backup,
          }
        : {
            kind,
            subject,
            direction: mediaDirection,
            style,
            use_story: true,
            natural_finish: true,
            enhance,
          }
      const queued = await api(
        path(generate ? "/api/images/generate" : "/api/images/prepare"),
        body,
      )
      setStatus(
        "Your request is queued. You can keep working in another part of your story.",
      )
      await refresh()
      const job = await waitJob(queued.job_id, (j) => setStatus(j.message))
      if (generate) {
        await load()
        setStatus("Your image is ready.")
      } else {
        setPrompt(job.result.prompt)
        setProvenance(job.result)
        setStatus("Your prompt is ready to review.")
      }
      await refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="page">
      <PageTitle
        eyebrow="BRING IT TO LIFE"
        title="Images"
        text="Turn a character, place or moment from your story into a visual. Review the prompt before rendering."
      />
      {error && (
        <p role="alert" className="live-status error">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="live-status">
          {status}
        </p>
      )}
      <div className="creative-layout">
        <section className="panel">
          <div className="form-grid">
            <label className="field">
              What are we making?
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {[
                  "scene",
                  "character",
                  "location",
                  "prop",
                  "storyboard",
                  "custom",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Visual style
              <input value={style} onChange={(e) => setStyle(e.target.value)} />
            </label>
          </div>
          <label className="field">
            A little more detail
            <textarea
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Leave blank to let your story guide the image."
              maxLength={1500}
            />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={enhance}
              onChange={(e) => setEnhance(e.target.checked)}
            />
            Let the writing model refine the visual prompt
          </label>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void submit(false)}
          >
            Prepare my prompt
          </button>
          <label className="field">
            Your image prompt
            <textarea
              className="tall"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={4000}
              placeholder="Prepare a prompt above, or write your own."
            />
          </label>
          <details>
            <summary>Image settings</summary>
            <label className="field">
              Image model
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.id}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              <label className="field">
                Shape
                <select
                  value={shape}
                  onChange={(e) => setShape(e.target.value)}
                >
                  {shapes.map((s: string) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Quality
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                >
                  {resolutions.map((s: string) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            {model.startsWith("muse") && (
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={backup}
                  onChange={(e) => setBackup(e.target.checked)}
                />
                Use Vultr backup if Muse fails
              </label>
            )}
          </details>
          <button
            className="primary"
            disabled={busy || !prompt.trim() || !model}
            onClick={() => void submit(true)}
          >
            {busy ? "Working…" : "Generate image"}
          </button>
          {provenance && (
            <details>
              <summary>What informed this image?</summary>
              <p>{provenance.prompt_provider}</p>
              <p>{provenance.sources?.join(", ")}</p>
              {provenance.assumptions?.map((a: string) => <p key={a}>{a}</p>)}
            </details>
          )}
        </section>
        <section className="gallery">
          <button
            className="text-action"
            onClick={() => void load().catch((e) => setError(e.message))}
          >
            Refresh saved images
          </button>
          {images.map((img) => (
            <article className="panel image-card" key={img.id}>
              {img.images?.map((im: any) => (
                <img
                  loading="lazy"
                  key={im.index}
                  src={path(`/media/images/${img.id}/${im.index}.png`)}
                  alt={img.title}
                />
              ))}
              <h3>{img.title}</h3>
              <small>
                {img.status} · {img.provider ? img.provider + " · " : ""}{img.model}
              </small>
              {img.fallback && (
                <p className="hint">Backup used: {img.fallback.reason}</p>
              )}
              <div className="comment-actions">
                <button onClick={()=>void useImage(img,'prompt')}>Reuse prompt</button>
                <button disabled={!img.images?.length} onClick={()=>void useImage(img,'production')}>Scout this location</button>
                <button onClick={()=>void useImage(img,'music')}>Add sound</button>
                {img.images?.[0] && (
                  <a href={path(`/media/images/${img.id}/0.png?download=true`)}>
                    Download
                  </a>
                )}
              </div>
            </article>
          ))}
          {!images.length && (
            <div className="empty illustrated-empty">
              <Artwork name="forest-path" />
              <div className="empty-copy">
                <span className="eyebrow">A WORLD WAITING TO BE SEEN</span>
                <h3>Give your story a visual voice.</h3>
                <p>
                  Your generated images will appear here, saved with their
                  prompts and sources.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
