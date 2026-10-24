import { useEffect, useState } from "react";
import { hash, now, slug, uid } from "../data";
import { useStudio } from "../store";
import type { AudioMode, Track } from "../types";
import { ago, Icon, PageTitle, Segmented } from "../ui";

const LAYERS: Record<string, RegExp> = { wind: /wind|storm|air|gust|smoke/i, water: /sea|rain|river|water|wave|tide/i, rumble: /city|crowd|war|engine|gate|thunder/i, fire: /fire|torch|hearth|flame|ember/i };
const RATE = 22050;

/** Deterministic procedural ambience: seeded noise shaped into wind, water, rumble and fire layers, written as 16-bit PCM WAV. */
function synth(layers: string[], seconds: number, seed: number): Blob {
  let s = seed || 1;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const n = RATE * seconds, data = new Int16Array(n);
  let lp = 0, bp = 0, crackle = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE, noise = rnd();
    lp += 0.02 * (noise - lp); bp += 0.25 * (noise - bp);
    let v = 0;
    if (layers.includes("wind")) v += lp * 3 * (0.6 + 0.4 * Math.sin(t * 0.4 + Math.sin(t * 0.13)));
    if (layers.includes("water")) v += (bp - lp) * 0.5 * (0.7 + 0.3 * Math.sin(t * 1.7));
    if (layers.includes("rumble")) v += Math.sin(2 * Math.PI * 48 * t) * 0.18 * (0.5 + 0.5 * Math.sin(t * 0.21));
    if (layers.includes("fire")) { if (rnd() > 0.9993) crackle = 1; crackle *= 0.985; v += crackle * noise * 0.6 + lp * 0.6; }
    const fade = Math.min(1, t / 1.5, (seconds - t) / 1.5);
    data[i] = Math.max(-1, Math.min(1, v * fade * 0.8)) * 32767;
  }
  const buf = new ArrayBuffer(44 + data.byteLength), dv = new DataView(buf);
  const str = (o: number, x: string) => [...x].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); dv.setUint32(4, 36 + data.byteLength, true); str(8, "WAVEfmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, RATE, true); dv.setUint32(28, RATE * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, "data"); dv.setUint32(40, data.byteLength, true);
  new Int16Array(buf, 44).set(data);
  return new Blob([buf], { type: "audio/wav" });
}

export default function Music() {
  const { store, setStore, project, notify } = useStudio();
  const [mode, setMode] = useState<AudioMode>("Ambient soundscape"), [sceneId, setSceneId] = useState(project.scenes.find((s) => s.content.trim())?.id || ""), [seconds, setSeconds] = useState(12), [lyrics, setLyrics] = useState("");
  const [urls, setUrls] = useState<Record<string, string>>({});
  const scene = project.scenes.find((s) => s.id === sceneId);
  const text = `${scene?.content || ""} ${scene?.location || ""} ${project.brief.worldRules.join(" ")}`;
  const detected = Object.keys(LAYERS).filter((k) => LAYERS[k].test(text));
  const layers = detected.length ? detected : ["wind"];
  const cue = scene ? `${scene.title}: ${project.brief.tone.toLowerCase()} ${scene.night ? "night" : "day"} at ${scene.location || "unspecified location"}` : project.brief.premise;
  const tracks = store.tracks.filter((t) => t.projectId === project.id);

  useEffect(() => () => Object.values(urls).forEach(URL.revokeObjectURL), []);
  const urlFor = (t: Track) => urls[t.id] || "";
  const render = (t: Track) => { if (urls[t.id]) return; setUrls((u) => ({ ...u, [t.id]: URL.createObjectURL(synth(t.layers, t.seconds, parseInt(hash(t.id), 16))) })); };

  const create = () => {
    const t: Track = { id: uid(), projectId: project.id, mode, cue, layers: mode === "Ambient soundscape" ? layers : [], seconds, status: mode === "Ambient soundscape" ? "Saved" : "Needs connection", created: now() };
    setStore((s) => ({ ...s, tracks: [t, ...s.tracks] }));
    if (mode === "Ambient soundscape") { render(t); notify("Ambience synthesized locally — no inference key used"); }
    else notify(`${mode} queued locally; it needs a Vultr connection to generate`);
  };

  return <div className="page">
    <PageTitle eyebrow="SOUNDTRACKS" title="Soundtracks" text="Narrative cue planning from prose, world rules and canon. Ambient soundscapes are synthesized on this device; scores and songs use the provider music API." />
    <div className="creative-layout">
      <section className="panel">
        <Segmented label="Audio mode" value={mode} options={["Ambient soundscape", "Cinematic score", "Song"] as const} onChange={setMode} />
        <label className="field">Source scene<select value={sceneId} onChange={(e) => setSceneId(e.target.value)}>{project.scenes.map((s) => <option value={s.id} key={s.id}>{s.title}</option>)}</select></label>
        <div className="cue"><span className="eyebrow">CUE PLAN</span><p>{cue}</p>{mode === "Ambient soundscape" && <div className="tag-row">{["wind", "water", "rumble", "fire"].map((l) => <span key={l} className={layers.includes(l) ? "on" : ""}>{l}</span>)}</div>}<small>Derived from: {scene ? `${scene.id}, ` : ""}brief tone, world rules</small></div>
        <label className="field slider">Duration <b>{seconds}s</b><input type="range" min={5} max={mode === "Ambient soundscape" ? 30 : 180} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} /></label>
        {mode === "Song" && <label className="field">Lyrics (required)<textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} /></label>}
        {mode === "Cinematic score" && <p className="hint">Score section tags request instrumental output but cannot guarantee no vocals.</p>}
        <button className="primary" disabled={mode === "Song" && !lyrics.trim()} onClick={create}><Icon name="music" size={15} />{mode === "Ambient soundscape" ? "Synthesize" : "Request generation"}</button>
        <p className="hint">Stopping playback does not cancel paid generation; use Cancel on the job.</p>
      </section>
      <section className="results">
        {tracks.map((t) => <article className="panel result" key={t.id}>
          <div className="finding-head"><b>{t.mode}</b><small>{ago(t.created)} · {t.seconds}s</small><span>{t.status}</span></div>
          <p>{t.cue}</p>{t.layers.length > 0 && <div className="tag-row">{t.layers.map((l) => <span key={l} className="on">{l}</span>)}</div>}
          {t.status === "Saved" ? (urlFor(t) ? <><audio controls src={urlFor(t)} /><div className="comment-actions"><a href={urlFor(t)} download={`${slug(project.title)}-${t.id}.wav`}>Download WAV</a></div></> : <button className="secondary" onClick={() => render(t)}><Icon name="play" size={15} />Render audio</button>)
            : <div className="comment-actions"><span>Waiting for a provider connection</span><button onClick={() => setStore((s) => ({ ...s, tracks: s.tracks.filter((x) => x.id !== t.id) }))}>Cancel</button></div>}
        </article>)}
        {!tracks.length && <div className="empty"><Icon name="music" /><h3>No tracks yet</h3><p>Cue manifests and saved audio are kept per project.</p></div>}
      </section>
    </div>
  </div>;
}
