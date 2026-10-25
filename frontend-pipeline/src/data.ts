import type { Brief, Finding, ModeId, Project, Scene } from "./types";

export const uid = () => Math.random().toString(36).slice(2, 10);
export const now = () => new Date().toISOString();
export const words = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

/** Short, stable content fingerprint used to bind acceptance to exact prose. */
export const hash = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
};

export const MODES: { id: ModeId; name: string; workflow: string; summary: string; stages: string[] }[] = [
  { id: "sequential", name: "Sequential", workflow: "living-universe-pipeline.yml", summary: "Writes one scene at a time, with review, fixes and memory checks before anything becomes canon.", stages: ["Literary preparation", "Refinement", "Scene plan", "Writing", "Story · rhetoric · memory review", "Targeted repair", "Memory extraction", "Canon acceptance"] },
  { id: "planned-parallel", name: "Deep planned parallel", workflow: "planned-parallel.yml", summary: "Plans the story as a whole, locks each scene plan, writes scenes in parallel, then checks that everything fits before joining the manuscript.", stages: ["Story board", "Plan refinement", "Plan lock", "Parallel scene writing", "Local coherence", "Global coherence", "Targeted corrections", "Publish manuscript"] },
  { id: "parallel-scenes", name: "Parallel scene reconciler", workflow: "parallel-scenes.yml", summary: "Sets out what each scene has to do, drafts the scenes side by side, then reconciles the facts before canon. Up to 24 scenes.", stages: ["Scene contracts", "Handoff checks", "Matrix drafting", "Fact reconciliation", "Convergence", "Canon release"] },
  { id: "living-universe", name: "Living universe", workflow: "living-universe.yml", summary: "Keeps a world running from your cast, rules and facts. Writes a set number of events and episodes, and picks up from the last approved checkpoint.", stages: ["Load checkpoint", "World event proposals", "Director selection", "Episode writing", "Lifecycle validation", "Episode audit", "Checkpoint"] },
  { id: "classic-expansion", name: "Classic expansion graph", workflow: "cinematic-expansion.yml", summary: "Splits the work into separate jobs for events, characters, beats, reviews and paragraph fixes.", stages: ["Fast preparation", "Event planning", "Character proposals", "Beat writing", "Readable draft", "Review batches", "Paragraph repairs", "Final approval"] },
];
export const modeOf = (id: ModeId) => MODES.find((m) => m.id === id)!;

export const WORKERS = 2;
export const QUEUE_LIMIT = 4;

/** Author workspace checks. Full runner contracts are validated before publishing. */
export function validateBrief(b: Brief): string[] {
  const e: string[] = [];

  if (b.chapters < 1 || b.chapters > 40) e.push("Chapters must be between 1 and 40.");
  if (b.scenesPerChapter < 1 || b.scenesPerChapter > 12) e.push("Scenes per chapter must be between 1 and 12.");
  if (b.wordMin < 100 || b.wordMax > 6000 || b.wordMin > b.wordMax) e.push("Keep the scene word range between 100 and 6000, with min no higher than max.");
  const names = b.characters.map((c) => c.name.trim().toLowerCase()).filter(Boolean);
  if (new Set(names).size !== names.length) e.push("Character names must be unique.");
  if (b.characters.some((c) => !c.name.trim())) e.push("Every character needs a name.");
  return e;
}

/** Deterministic local checks only: length, must-avoid terms, repetition, medium form. Not a literary judgement. */
export function mechanicalReview(scene: Scene, brief: Brief): Finding[] {
  const out: Finding[] = [];
  const n = words(scene.content);
  if (n && brief.lengthMode === "Strict" && (n < brief.wordMin || n > brief.wordMax))
    out.push({ id: uid(), dimension: "Story", severity: "Blocking", quote: `${n} words`, note: `Strict length requires ${brief.wordMin}–${brief.wordMax} words.`, status: "Open", source: "Mechanical check" });
  else if (n && n < brief.wordMin)
    out.push({ id: uid(), dimension: "Story", severity: "Minor", quote: `${n} words`, note: `Below the guided target of ${brief.wordMin}. Length expansion can insert source-owned detail.`, status: "Open", source: "Mechanical check" });
  for (const term of brief.mustAvoid) {
    const hit = term.trim() && scene.content.toLowerCase().includes(term.trim().toLowerCase());
    if (hit) out.push({ id: uid(), dimension: "Rhetoric", severity: "Major", quote: term, note: "Appears in the must-avoid list.", status: "Open", source: "Mechanical check" });
  }
  const rep = scene.content.match(/\b(\w{3,})[,\s]+\1\b/i);
  if (rep) out.push({ id: uid(), dimension: "Rhetoric", severity: "Minor", quote: rep[0], note: "Immediate word repetition.", status: "Open", source: "Mechanical check" });
  if (brief.medium === "Screenplay" && scene.content.trim() && !/^(INT\.|EXT\.)/m.test(scene.content))
    out.push({ id: uid(), dimension: "Story", severity: "Major", quote: scene.content.split("\n")[0].slice(0, 60), note: "Screenplay scenes need an INT./EXT. heading.", status: "Open", source: "Mechanical check" });
  if (brief.medium === "Audio drama" && scene.content.trim() && !/SOUND:|MUSIC:/.test(scene.content))
    out.push({ id: uid(), dimension: "Story", severity: "Minor", quote: scene.title, note: "Audio drama scenes usually carry SOUND: or MUSIC: cues.", status: "Open", source: "Mechanical check" });
  return out;
}

export type ManuscriptLabel = "Final" | "Provisional" | "Partial";
export function manuscriptLabel(p: Project): ManuscriptLabel {
  if (p.scenes.length && p.scenes.every((s) => s.state === "Accepted")) return "Final";
  return p.scenes.some((s) => s.content.trim() && s.state !== "Accepted") ? "Provisional" : "Partial";
}

export const download = (name: string, body: string, type = "text/plain") => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
export const slug = (s: string) => s.toLowerCase().replace(/\W+/g, "-").replace(/^-|-$/g, "");

/** CSV cell with spreadsheet formula neutralisation. */
export const csvCell = (v: string | number) => {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: (string | number)[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\n");

/** Sample of the literary corpus used for local retrieval previews. */
