import { useState } from "react";
import { download, manuscriptLabel, slug } from "../data";
import { useStudio } from "../store";
import { ago, Icon, PageTitle } from "../ui";

type Entry = { path: string; kind: "Markdown" | "JSON" | "Image" | "Audio" | "Text"; project: string; updated: string; body: () => string; mime: string };

export default function Library() {
  const { store, notify } = useStudio();
  const [kind, setKind] = useState("All"), [q, setQ] = useState(""), [preview, setPreview] = useState<Entry | null>(null);
  const entries: Entry[] = store.projects.flatMap((p): Entry[] => {
    const root = `runs/studio-projects/${slug(p.title)}`;
    return [
      { path: `${root}/brief.json`, kind: "JSON" as const, project: p.title, updated: p.updated, mime: "application/json", body: () => JSON.stringify(p.brief, null, 2) },
      { path: `${root}/manuscript-${manuscriptLabel(p).toLowerCase()}.md`, kind: "Markdown" as const, project: p.title, updated: p.updated, mime: "text/markdown", body: () => p.scenes.map((s) => `## ${s.title}\n\n${s.content}`).join("\n\n") },
      { path: `${root}/canon/ledger.json`, kind: "JSON" as const, project: p.title, updated: p.updated, mime: "application/json", body: () => JSON.stringify(p.canon, null, 2) },
      ...store.images.filter((i) => i.projectId === p.id).map((i) => ({ path: `${root}/images/${i.id}/manifest.json`, kind: "Image" as const, project: p.title, updated: i.created, mime: "application/json", body: () => JSON.stringify(i, null, 2) })),
      ...store.tracks.filter((t) => t.projectId === p.id).map((t) => ({ path: `${root}/soundtracks/${t.id}/cue.json`, kind: "Audio" as const, project: p.title, updated: t.created, mime: "application/json", body: () => JSON.stringify(t, null, 2) })),
    ];
  }).concat(store.creative.map((c): Entry => ({ path: `runs/studio-creative/${c.id}.txt`, kind: "Text" as const, project: "Creative workspace", updated: c.created, mime: "text/plain", body: () => c.output })));
  const shown = entries.filter((e) => (kind === "All" || e.kind === kind) && e.path.toLowerCase().includes(q.toLowerCase()));

  return <div className="page">
    <PageTitle eyebrow="OUTPUTS" title="File library" text="Story, JSON, Markdown, image and audio records from registered projects. In the studio app this lists real files under outputs and runs with path checks." />
    <div className="toolbar"><label><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by path" /></label>
      <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}>{["All", "Markdown", "JSON", "Image", "Audio", "Text"].map((k) => <option key={k}>{k}</option>)}</select></div>
    <div className="runs-layout">
      <div className="review-list">{shown.map((e) => <button key={e.path} className={`review-item file-row ${preview?.path === e.path ? "selected" : ""}`} onClick={() => setPreview(e)}>
        <span className="kind">{e.kind}</span><div><h3>{e.path.split("/").pop()}</h3><p>{e.project} · {e.path}</p></div><small>{ago(e.updated)}</small>
      </button>)}{!shown.length && <p className="quiet pad">No files match.</p>}</div>
      {preview && <aside className="panel run-detail"><span className="eyebrow">{preview.kind}</span><h2>{preview.path.split("/").pop()}</h2><pre className="preview">{preview.body().slice(0, 4000)}</pre>
        <button className="primary" onClick={() => { download(preview.path.split("/").pop()!, preview.body(), preview.mime); notify("Downloaded"); }}><Icon name="download" size={15} />Download</button></aside>}
    </div>
  </div>;
}
