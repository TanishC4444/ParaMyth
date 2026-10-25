import { useEffect, useRef, useState } from "react"
import { useSavedJob } from "../useSavedJob"
import { api, projectPath, currentWorkspaceIdentity } from "../api"
import { useStudio, useDraftState } from "../store"
import { errorText, PageTitle } from "../ui"
import { useMaterials } from "../materials"
import { BrandSpot } from "../brandArt"
import { HelpTip } from '../Guide'
type ReferenceImage = { id: string; name: string; width: number; height: number }
export default function Images({ embedded = false }: { embedded?: boolean }) {
  const { project, flush, refresh, go, setMediaDirection, mediaDirection, setDraft } =
    useStudio()
  const { source, sourceId, signature, streaming, images, refreshMaterials: load } = useMaterials()
  const [references, setReferences] = useState<ReferenceImage[]>([])
  const [referenceIds, setReferenceIds] = useDraftState<string[]>('images.referenceIds', [])
  const [referenceDirection, setReferenceDirection] = useDraftState('images.referenceDirection', '')
  const [uploading, setUploading] = useState(false)
  const workspaceKey = currentWorkspaceIdentity() + ':' + project.id
  const activeWorkspace = useRef(workspaceKey)
  activeWorkspace.current = workspaceKey
  const [models, setModels] = useState<any[]>([]),
    [model, setModel] = useDraftState("images.model", ""),
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
  const busy = submitting || uploading || !!pendingJob
  const path = (p: string) => projectPath(p, project.id)
  useEffect(() => {
    let live = true
    setReferences([]); setUploading(false)
    api<{references: ReferenceImage[]}>(path('/api/images/references'))
      .then(value => { if (live) setReferences(value.references) })
      .catch(e => { if (live) setError(errorText(e)) })
    return () => { live = false }
  }, [workspaceKey])
  const toggleReference = (id: string) => {
    if (referenceIds.includes(id)) { setReferenceIds(referenceIds.filter(value => value !== id)); return }
    if (referenceIds.length >= 3) { setError('Choose up to three reference images.'); return }
    setReferenceIds([...referenceIds, id]); setModel('muse-image-1.0')
  }
  const upload = async (files: File[]) => {
    if (!files.length || busy) return
    if (referenceIds.length + files.length > 3) { setError('Choose up to three reference images. Clear a selection before uploading more.'); return }
    if (files.some(file => !/\.(png|jpe?g|webp)$/i.test(file.name) || file.size > 5 * 1024 * 1024)) {
      setError('Choose PNG, JPG or WebP images under 5 MB each.'); return
    }
    const identity = workspaceKey
    setUploading(true); setError('')
    try {
      for (const file of files) {
        if (activeWorkspace.current !== identity) break
        const reference = await api<ReferenceImage>(path('/api/images/references?name=' + encodeURIComponent(file.name)), file)
        if (activeWorkspace.current !== identity) break
        setReferences(rows => [reference, ...rows])
        setReferenceIds(ids => [...ids, reference.id])
        setModel('muse-image-1.0')
      }
    } catch (e) { if (activeWorkspace.current === identity) setError(errorText(e)) }
    finally { if (activeWorkspace.current === identity) setUploading(false) }
  }
  useEffect(() => {
    let live = true
    api("/api/images/models")
      .then((v) => {
        if (live) {
          setModels(v.models)
          setModel((previous) => v.models.some((m: any) => m.id === previous) ? previous : v.models[0]?.id || "")
        }
      })
      .catch(() => {if(live){setModels([]);setModel('');setError("Image generation isn't available in this studio yet.")}})
    return () => { live = false }
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
  const submit = async (generate: boolean, automatic = false) => {
    const editing = generate && referenceIds.length > 0
    if (editing && !referenceDirection.trim()) { setError('Describe how Muse should change or use your reference images.'); return }
    if (editing) automatic = false
    setSubmitting(true)
    setError("")
    try {
      await flush()
      const body = automatic ? {model,kind,subject,style,source,direction:mediaDirection,enhance,aspect_ratio:shape,resolution,n:1,allow_backup:backup} : generate
        ? {
            model,
            prompt: editing ? referenceDirection.trim() : prompt.slice(0, 3700) + "\nNatural finish: Distinct faces, subtle asymmetry, unposed gestures, plausible anatomy and weight, motivated light, worn materials and restrained highlights. Avoid waxy skin, identical faces, excessive glow and oversharpening. Preserve the requested medium and story details.",
            aspect_ratio: shape,
            resolution,
            n: 1,
            kind: editing ? 'custom' : kind,
            title: editing ? referenceDirection.trim().slice(0, 100) : subject || kind,
            allow_backup: editing ? false : backup,
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
        path(automatic ? '/api/images/create' : generate ? "/api/images/generate" : "/api/ui/images/prepare"),
        generate ? {...body, reference_ids: referenceIds} : body,
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
      <PageTitle level={embedded ? "h2" : "h1"}
        title="Visuals"
        text="Create a visual from your story, or upload reference images and describe an edit."
      ><HelpTip label="How visuals use your writing">Create visual uses your current writing or your own image prompt. For a reference edit, select uploaded images and describe the changes. Each result is saved as a new image; your original references are preserved.</HelpTip></PageTitle>
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
          <section className="image-references" aria-label="Reference images">
            <h2>Reference images <small>optional</small></h2>
            <p className="hint">Upload up to three images, then describe what to change or combine. PNG, JPG or WebP · up to 5 MB each.</p>
            <label className="field">Upload reference images
              <input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" multiple disabled={busy || referenceIds.length >= 3}
                onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ''; void upload(files) }} />
            </label>
            {uploading && <p role="status">Uploading reference images…</p>}
            {!!references.length && <details open={referenceIds.length > 0}><summary>Saved references · {referenceIds.length} selected</summary>
              <div className="reference-grid">{references.map(reference => <label className="reference-card" key={reference.id}>
                <img src={path('/media/image-references/' + reference.id)} alt={reference.name} loading="lazy" />
                <span><input type="checkbox" checked={referenceIds.includes(reference.id)} disabled={busy}
                  onChange={() => toggleReference(reference.id)} />{reference.name}</span>
              </label>)}</div>
            </details>}
            {referenceIds.length > 0 && <>
              <button className="text-action" disabled={busy} onClick={() => setReferenceIds([])}>Clear reference selection</button>
              <label className="field">How should Muse use these images?
                <textarea value={referenceDirection} onChange={e => setReferenceDirection(e.target.value)} maxLength={4000}
                  placeholder="Keep the character’s face and pose, change the coat to blue, and place them in a moonlit forest." />
              </label>
              <p className="hint">Your selected images and these instructions are sent to Meta when you choose Generate edit. Originals stay saved in this project.</p>
            </>}
          </section>
          <div hidden={referenceIds.length > 0}>
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
          <details className="workspace-options"><summary>Prompt options</summary><label className="toggle">
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
          </details>
          </div>
          <details>
            <summary>Image settings</summary>
            <label className="field">
              Image model
              <select disabled={referenceIds.length > 0} value={model} onChange={(e) => setModel(e.target.value)}>
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
            {model.startsWith("muse") && !referenceIds.length && (
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
            disabled={busy || !models.some(item=>item.id===model) || referenceIds.length > 0 && !referenceDirection.trim()}
            onClick={() => void submit(true,!prompt.trim())}
          >
            {busy ? "Working…" : referenceIds.length ? "Generate edit" : "Create visual"}
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
                <button disabled={!img.images?.length} onClick={()=>void useImage(img,'production')}>Use in production</button>
                {img.images?.[0] && (
                  <a href={path(`/media/images/${img.id}/0.png?download=true`)}>
                    Download
                  </a>
                )}
              </div>
              <details><summary>More image actions</summary><div className="comment-actions"><button onClick={()=>void useImage(img,'prompt')}>Reuse prompt</button><button onClick={()=>void useImage(img,'music')}>Add sound</button></div></details>
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
