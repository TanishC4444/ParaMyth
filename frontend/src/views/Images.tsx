import { useEffect, useState } from "react"
import { useSavedJob } from "../useSavedJob"
import { api, projectPath } from "../api"
import { useStudio, useDraftState } from "../store"
import { errorText, PageTitle } from "../ui"
import { useMaterials } from "../materials"
import { BrandSpot } from "../brandArt"
export default function Images() {
  const { project, flush, refresh, go, setMediaDirection, mediaDirection, setDraft } =
    useStudio()
  const { source, sourceId, signature, streaming } = useMaterials()
  const [models, setModels] = useState<any[]>([]),
    [model, setModel] = useDraftState("images.model", ""),
    [images, setImages] = useState<any[]>([]),
    [kind, setKind] = useDraftState("images.kind", "scene"),
    [subject, setSubject] = useDraftState("images.subject", ""),
    [style, setStyle] = useDraftState("images.style", "Auto - match story"),
    [shape, setShape] = useDraftState("images.shape", ""),
    [resolution, setResolution] = useDraftState("images.resolution", ""),
    [prompt, setPrompt] = useDraftState("images.prompt", ""),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [submitting, setSubmitting] = useState(false),
    [enhance, setEnhance] = useDraftState("images.enhance", true),
    [backup, setBackup] = useDraftState("images.backup", true),
    [provenance, setProvenance] = useDraftState<any>("images.provenance", null)
  const [pendingJob, setPendingJob] = useSavedJob("images.pendingJob", ["image", "image-prompt"], {
    progress: (j) => { setStatus(j.message); setError("") },
    complete: async (j) => {
      if (j.kind === "image") {
        if (provenance?.source_id && j.result?.id) await api(path(`/api/ui/images/${j.result.id}/source`), { source: provenance.source_id });
        await load(); setStatus("Your image is ready.") }
      else { setPrompt(j.result.prompt); setProvenance(j.result); setStatus("Your prompt is ready to review.") }
      await refresh()
    },
    failed: (message) => { setError(message); setStatus("") },
  })
  const busy = submitting || !!pendingJob
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
          setModel((previous) => v.models.some((m: any) => m.id === previous) ? previous : v.models[0]?.id || "")
        }
      })
      .catch((e) => live && setError(e.message))
    const changed = () => { void api(path("/api/images")).then((v) => { if (live) setImages(v.images); }).catch(() => {}); }
    window.addEventListener("studio-refresh", changed)
    window.addEventListener("studio-shared-update", changed)
    return () => { live = false; window.removeEventListener("studio-refresh", changed); window.removeEventListener("studio-shared-update", changed) }
  }, [project.id])
  const useImage=async(img:any,destination:'prompt'|'production'|'music')=>{
    try{
      const record=await api(path('/api/images/'+img.id));
      if(destination==='prompt'){setPrompt(record.request.prompt);setProvenance({prompt_provider:record.provider,sources:[],assumptions:record.fallback?[record.fallback.reason]:[]});return}
      if(destination==='production'){ setDraft(project.id,'production.imageId',img.id); setDraft(project.id,'production.imageIds',[img.id]); }
      setMediaDirection(img.title+': '+record.request.prompt.slice(0,650));go(destination);
    }catch(e){setError(errorText(e))}
  };
  const selected = models.find((x) => x.id === model),
    params = selected?.supported_parameters || {},
    shapes = params.aspect_ratio?.values || [],
    resolutions = params.resolution?.values || []
  useEffect(() => {
    if (!selected) return
    setShape((previous) => shapes.includes(previous) ? previous : shapes.includes("16:9") ? "16:9" : shapes[0] || "")
    setResolution((previous) => resolutions.includes(previous) ? previous : resolutions[0] || "")
  }, [model, models])
  const submit = async (generate: boolean) => {
    setSubmitting(true)
    setError("")
    try {
      await flush()
      const body = generate
        ? {
            model,
            prompt: prompt.slice(0, 3700) + "\nNatural finish: Distinct faces, subtle asymmetry, unposed gestures, plausible anatomy and weight, motivated light, worn materials and restrained highlights. Avoid waxy skin, identical faces, excessive glow and oversharpening. Preserve the requested medium and story details.",
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
            source,
            enhance,
          }
      const queued = await api(
        path(generate ? "/api/images/generate" : "/api/ui/images/prepare"),
        body,
      )
      setStatus(
        "Your request is queued. You can keep working in another part of your story.",
      )
      setPendingJob({ id: queued.job_id, kind: generate ? "image" : "image-prompt", local: queued.local })
      await refresh()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <div className="page">
      <PageTitle
        title="Images"
        text="Turn a character, place or moment from your story into a visual. Review the prompt before rendering."
      />
      {streaming && <p className="hint" role="status">Following your live writing. Prepare a prompt to use its latest details.</p>}
      {provenance?.source_signature && provenance.source_signature !== signature && <p className="source-changed">The writing has changed since this prompt. <button disabled={busy} onClick={()=>void submit(false)}>Update prompt from writing</button></p>}
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
              maxLength={3700}
              placeholder="Prepare a prompt above, or write your own."
            />
          </label>
          {prompt && provenance?.source_id !== sourceId && <p className="hint">Your saved prompt stays as written. Choose Prepare my prompt to use the current writing.</p>}
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
              <BrandSpot kind="image" />
              <div className="empty-copy">
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
