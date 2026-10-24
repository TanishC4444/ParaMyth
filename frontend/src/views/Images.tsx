import { useState } from "react";
import { now, uid } from "../data";
import { useStudio } from "../store";
import { IMAGE_STYLES, IMAGE_SUBJECTS, type ImageRecord } from "../types";
import { ago, Icon, PageTitle, Segmented } from "../ui";

const PROVIDERS = { "Meta Muse Image": ["muse-image"], "Vultr": ["MOSS-Image", "flux-schnell"] } as const;
type Provider = keyof typeof PROVIDERS;
const SHAPES = ["16:9", "1:1", "3:4", "9:16"] as const;

/** Local stand-in for the story-cue style selector in visual_direction.py. */
const autoStyle = (text: string, subject: string) => {
  const t = text.toLowerCase();
  if (subject === "Storyboard frame") return "Pencil storyboard";
  if (/noir|detective|rain|neon/.test(t)) return "Noir photography";
  if (/greenhouse|botan|science|station|orbit/.test(t)) return "Grounded science fiction";
  if (/troy|bronze|myth|ancient|medieval/.test(t)) return "Period film still";
  if (/tale|fairy|forest|wolf/.test(t)) return "Gouache storybook";
  return "Documentary film still";
};

const Render = ({ img }: { img: ImageRecord }) => {
  const hue = img.seed % 360, [w, h] = img.shape.split(":").map(Number);
  return <svg viewBox={`0 0 ${w * 40} ${h * 40}`} role="img" aria-label={`Placeholder render for ${img.subject}`}>
    <defs><linearGradient id={`g${img.id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={`hsl(${hue} 45% 72%)`} /><stop offset="1" stopColor={`hsl(${(hue + 50) % 360} 40% 38%)`} /></linearGradient></defs>
    <rect width="100%" height="100%" fill={`url(#g${img.id})`} />
    <circle cx={`${30 + (img.seed % 40)}%`} cy="38%" r={h * 6} fill="rgba(255,255,255,.35)" />
    <path d={`M0 ${h * 30} Q ${w * 12} ${h * 22} ${w * 22} ${h * 28} T ${w * 40} ${h * 26} V ${h * 40} H 0 Z`} fill="rgba(20,30,60,.35)" />
  </svg>;
};

export default function Images() {
  const { store, setStore, project, notify, go } = useStudio();
  const scenes = project.scenes.filter((s) => s.content.trim());
  const [subject, setSubject] = useState<string>("Scene"), [sceneId, setSceneId] = useState(scenes[0]?.id || ""), [context, setContext] = useState(true);
  const [provider, setProvider] = useState<Provider>("Meta Muse Image"), [backup, setBackup] = useState(true), [style, setStyle] = useState<string>("Automatic"), [custom, setCustom] = useState(""), [natural, setNatural] = useState(true), [shape, setShape] = useState<(typeof SHAPES)[number]>("16:9"), [seed, setSeed] = useState(""), [prompt, setPrompt] = useState("");
  const scene = scenes.find((s) => s.id === sceneId);
  const chosen = custom.trim() || (style === "Automatic" ? autoStyle(`${project.brief.genre} ${project.brief.premise} ${scene?.content || ""}`, subject) : style);

  const prepare = () => {
    const source = context && scene ? `${scene.title} — ${scene.content.split("\n")[0].slice(0, 240)}` : "";
    const finish = natural ? (/painting|gouache|watercolor|pencil/i.test(chosen) ? "Purposeful variation in marks and pigment." : "Motivated light, natural skin texture, plausible contact, material wear, coherent shadows. No waxy retouching, excess HDR or synthetic bokeh.") : "";
    setPrompt([`${subject}${context ? ` from ${project.title}` : ""}.`, source, `Style: ${chosen}${style === "Automatic" && !custom ? " (automatic, provisional)" : ""}.`, "Preserve described appearance, wardrobe, geography and era; restrained palette.", finish, context && scene ? `Sources: ${scene.id}` : "Assumptions: no story context used."].filter(Boolean).join("\n"));
  };
  const generate = () => {
    const rec: ImageRecord = { id: uid(), projectId: project.id, subject, prompt, style: chosen, provider, model: PROVIDERS[provider][0], shape, seed: seed ? Number(seed) : Math.floor(Math.random() * 99999), natural, created: now() };
    setStore((s) => ({ ...s, images: [rec, ...s.images] }));
    notify("Placeholder render saved with provenance");
  };
  const images = store.images.filter((i) => i.projectId === project.id);

  return <div className="page">
    <PageTitle eyebrow="VISUAL DIRECTION" title="Images" text="Story-aware prompts for characters, scenes, locations, props, storyboard frames and custom visuals. Prompt preparation is local; rendering needs a configured provider." />
    <div className="creative-layout">
      <section className="panel">
        <div className="field">Subject<Segmented label="Subject" value={subject} options={IMAGE_SUBJECTS} onChange={setSubject} /></div>
        <label className="toggle"><input type="checkbox" checked={context} onChange={(e) => setContext(e.target.checked)} />Use story context</label>
        {context && <label className="field">Source scene<select value={sceneId} onChange={(e) => setSceneId(e.target.value)}>{scenes.map((s) => <option value={s.id} key={s.id}>{s.title}</option>)}{!scenes.length && <option>No written scenes</option>}</select></label>}
        <div className="form-grid">
          <label className="field">Provider<select value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>{Object.keys(PROVIDERS).map((p) => <option key={p}>{p}</option>)}</select></label>
          <label className="field">Shape<select value={shape} onChange={(e) => setShape(e.target.value as typeof shape)}>{SHAPES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="field">Style<select value={style} onChange={(e) => setStyle(e.target.value)}>{IMAGE_STYLES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="field">Seed<input inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} placeholder="random" /></label>
        </div>
        <label className="field">Custom style (overrides automatic)<input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. faded Kodachrome travel slide" /></label>
        {provider === "Meta Muse Image" && <label className="toggle"><input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} />Vultr backup if Muse fails (records fallback provenance)</label>}
        <label className="toggle"><input type="checkbox" checked={natural} onChange={(e) => setNatural(e.target.checked)} />Natural finish</label>
        <p className="hint">Resolved style: <b>{chosen}</b>. Muse renders one image per request.</p>
        <div className="detail-actions"><button className="secondary" onClick={prepare}><Icon name="sparkle" size={15} />Prepare prompt</button><button className="primary" disabled={!prompt.trim()} onClick={generate}><Icon name="images" size={15} />Generate</button></div>
        <label className="field">Editable prompt<textarea className="tall" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Prepare a prompt, then edit before generating." /></label>
      </section>
      <section className="gallery">
        {images.map((img) => <article className="panel image-card" key={img.id}>
          <Render img={img} />
          <div className="finding-head"><b>{img.subject}</b><small>{ago(img.created)}</small></div>
          <dl className="provenance"><dt>Provider</dt><dd>{img.provider} · {img.model}</dd><dt>Style</dt><dd>{img.style}</dd><dt>Shape · seed</dt><dd>{img.shape} · {img.seed}</dd>{img.fallback && <><dt>Fallback</dt><dd>{img.fallback}</dd></>}</dl>
          <div className="comment-actions"><button onClick={() => { setPrompt(img.prompt); notify("Prompt loaded"); }}>Reuse prompt</button><button onClick={() => go("production")}>Send to scouting</button></div>
        </article>)}
        {!images.length && <div className="empty"><Icon name="images" /><h3>No images yet</h3><p>Renders here are offline placeholders. Connect Muse or Vultr in Connections for real PNGs with stored dimensions and hashes.</p></div>}
      </section>
    </div>
  </div>;
}
