import type { Brief, Fact, Finding, ModeId, Project, Run, Scene, Store } from "./types";

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
  { id: "sequential", name: "Sequential", workflow: "living-universe-pipeline.yml", summary: "Scene by scene through review, repair and memory checks before canon acceptance.", stages: ["Literary preparation", "Refinement", "Scene plan", "Writing", "Story · rhetoric · memory review", "Targeted repair", "Memory extraction", "Canon acceptance"] },
  { id: "planned-parallel", name: "Deep planned parallel", workflow: "planned-parallel.yml", summary: "Shared story board, locked scene plans, scenes on separate runners, then coherence checks and a joined manuscript.", stages: ["Story board", "Plan refinement", "Plan lock", "Parallel scene writing", "Local coherence", "Global coherence", "Bounded corrections", "Publish manuscript"] },
  { id: "parallel-scenes", name: "Parallel scene reconciler", workflow: "parallel-scenes.yml", summary: "Scene contracts and handoffs, independent matrix drafts, reconciliation before canon. Up to 24 scenes.", stages: ["Scene contracts", "Handoff checks", "Matrix drafting", "Fact reconciliation", "Convergence", "Canon release"] },
  { id: "living-universe", name: "Living universe", workflow: "living-universe.yml", summary: "Persistent world from cast, immutable rules and facts. Bounded events and episodes; resumes approved checkpoints.", stages: ["Load checkpoint", "World event proposals", "Director selection", "Episode writing", "Lifecycle validation", "Episode audit", "Checkpoint"] },
  { id: "classic-expansion", name: "Classic expansion graph", workflow: "cinematic-expansion.yml", summary: "Independent runner jobs for events, character proposals, beats, review batches and paragraph repairs.", stages: ["Fast preparation", "Event planning", "Character proposals", "Beat writing", "Readable draft", "Review batches", "Paragraph repairs", "Final approval"] },
];
export const modeOf = (id: ModeId) => MODES.find((m) => m.id === id)!;

export const WORKERS = 2;
export const QUEUE_LIMIT = 4;

const troyScenes: Scene[] = [
  { id: "t1", chapter: 1, title: "The watch on the wall", pov: "Andromache", location: "Scaean Gate", minutes: 6, night: true, state: "Accepted", findings: [], content: "Andromache counted the fires below the wall the way her mother had taught her to count debts: slowly, and without hope of forgiveness.\n\nHector did not ask why she had climbed. He stood beside her and let the wind carry the smoke between them." },
  { id: "t2", chapter: 1, title: "A horse at dawn", pov: "Cassandra", location: "Beach below Troy", minutes: 8, night: false, state: "In review", findings: [
    { id: "f1", dimension: "Memory", severity: "Blocking", quote: "the Greeks had sailed for home three days ago", note: "Canon fact e2 places the fleet's departure at dawn of this same day.", status: "Open", source: "Reviewer" },
    { id: "f2", dimension: "Rhetoric", severity: "Minor", quote: "silent, silent wood", note: "Repetition reads as accidental rather than incantatory.", status: "Open", source: "Mechanical check" },
  ], content: "The horse stood on the sand as though it had grown there, silent, silent wood bleached by a sea that had not yet decided whose side it was on.\n\nThe crowd said the Greeks had sailed for home three days ago. Cassandra said nothing at all, which frightened her brother more than any prophecy." },
  { id: "t3", chapter: 2, title: "Inside the gate", pov: "Andromache", location: "Palace courtyard", minutes: 5, night: true, state: "Draft", findings: [], content: "" },
];
const troyCanon: Fact[] = [
  { id: "e1", kind: "Event", text: "Hector and Andromache watch the Greek fires from the Scaean wall.", holders: ["Public"], sceneId: "t1", state: "Accepted" },
  { id: "e2", kind: "Event", text: "The Greek fleet departs at dawn, leaving the horse on the beach.", holders: ["Public"], sceneId: "t2", state: "Provisional" },
  { id: "b1", kind: "Belief", text: "Cassandra believes the horse holds soldiers.", holders: ["Cassandra"], sceneId: "t2", state: "Provisional" },
  { id: "r1", kind: "Relationship", text: "Andromache trusts Hector's silence more than his speeches.", holders: ["Andromache"], sceneId: "t1", state: "Accepted" },
  { id: "th1", kind: "Thread", text: "Counting as a way of bargaining with fate.", holders: ["Reader"], sceneId: "t1", state: "Accepted", thread: "Setup" },
];
const troyBrief: Brief = {
  premise: "The last night of Troy, told by the women who saw it coming and were not believed.", medium: "Novel", genre: "Mythic historical", tone: "Restrained, elegiac", pov: "Close third, rotating",
  themes: ["Disbelief", "Grief before loss", "Duty versus love"], worldRules: ["No gods appear on the page", "Prophecy is never believed"], mustAvoid: ["Modern idiom", "Battlefield gore"],
  chapters: 3, scenesPerChapter: 2, wordMin: 900, wordMax: 1400, lengthMode: "Guided",
  characters: [
    { id: "c1", name: "Andromache", goal: "Keep her son alive through the night", fear: "Outliving everyone she loves", voice: "Plain, exact, unwilling to beg", arc: { belief: "Duty will protect us", pressure: "The gate opens", choice: "Hide Astyanax against Hector's order", change: "Love is the only duty left" } },
    { id: "c2", name: "Cassandra", goal: "Make one person believe her", fear: "Being right alone", voice: "Fragmented, precise about objects", arc: { belief: "Truth spoken loudly will be heard", pressure: "The horse enters the city", choice: "Stop speaking", change: "Silence as testimony" } },
  ],
};

export const seedProjects = (): Project[] => [
  { id: "troy", title: "Troy: The Last Watch", owner: "Maya Chen", color: "peach", updated: now(), brief: troyBrief, scenes: troyScenes, canon: troyCanon, versions: [] },
  { id: "lantern", title: "Lantern Street", owner: "Leo Martin", color: "mint", updated: new Date(Date.now() - 86400000).toISOString(), versions: [], canon: [],
    brief: { ...troyBrief, premise: "A night-shift radio host takes calls from a street that was demolished in 1974.", medium: "Audio drama", genre: "Quiet supernatural", tone: "Warm, uncanny", pov: "Host-centred", themes: ["Memory", "Community"], worldRules: ["Callers never say the year"], mustAvoid: ["Jump scares"], chapters: 2, scenesPerChapter: 2, wordMin: 600, wordMax: 900, characters: [] },
    scenes: [{ id: "l1", chapter: 1, title: "Cold open", pov: "Ines", location: "Studio B", minutes: 4, night: true, state: "Draft", findings: [], content: "SOUND: Rain on a window. A kettle clicks off.\n\nINES: You're listening to Lantern Street after midnight. Lines are open." }] },
  { id: "glass", title: "Glasshouse", owner: "Priya Shah", color: "gold", updated: new Date(Date.now() - 172800000).toISOString(), versions: [], canon: [],
    brief: { ...troyBrief, premise: "Two botanists inherit a greenhouse that keeps the climate of the year it was built.", medium: "Screenplay", genre: "Grounded science fiction", tone: "Dry, tender", pov: "Objective", themes: ["Inheritance"], worldRules: ["The greenhouse climate is fixed to 1921"], mustAvoid: ["Exposition dumps"], chapters: 1, scenesPerChapter: 3, wordMin: 400, wordMax: 800, characters: [] },
    scenes: [{ id: "g1", chapter: 1, title: "INT. GREENHOUSE - DAY", pov: "", location: "Greenhouse", minutes: 3, night: false, state: "Accepted", findings: [], content: "INT. GREENHOUSE - DAY\n\nCondensation runs down glass panes. JUNE (40s) wipes a circle clear and finds a thermometer reading 1921 weather." }] },
];

export const seedRuns = (): Run[] => [
  { id: "r-1042", projectId: "troy", mode: "sequential", status: "Running", progress: 0.55, stage: "Story · rhetoric · memory review", started: new Date(Date.now() - 2400000).toISOString(), events: [{ at: new Date(Date.now() - 2400000).toISOString(), text: "Dispatched living-universe-pipeline.yml" }, { at: new Date(Date.now() - 900000).toISOString(), text: "Scene t2 drafted; review batch opened" }] },
  { id: "r-1037", projectId: "glass", mode: "planned-parallel", status: "Succeeded", progress: 1, stage: "Publish manuscript", started: new Date(Date.now() - 90000000).toISOString(), events: [{ at: new Date(Date.now() - 90000000).toISOString(), text: "Dispatched planned-parallel.yml" }, { at: new Date(Date.now() - 86000000).toISOString(), text: "Joined manuscript published" }] },
  { id: "r-1031", projectId: "troy", mode: "classic-expansion", status: "Failed", progress: 0.62, stage: "Review batches", started: new Date(Date.now() - 180000000).toISOString(), events: [{ at: new Date(Date.now() - 180000000).toISOString(), text: "Dispatched cinematic-expansion.yml" }, { at: new Date(Date.now() - 176000000).toISOString(), text: "Hosted review route timed out after bounded retries; approved prefix retained" }] },
];

export const seedStore = (): Store => ({
  projects: seedProjects(), runs: seedRuns(), creative: [], images: [], tracks: [], pins: [],
  ideas: [
    { id: "i1", label: "STORY ANGLE", title: "The courage to begin before everything is clear.", body: "A through-line for Andromache's last chapter.", color: "mint-note" },
    { id: "i2", label: "VISUAL DIRECTION", title: "Smoke, bronze, salt", body: "Low firelight, wind-worn linen, no glossy armour.", color: "peach-note" },
    { id: "i3", label: "STRUCTURE", title: "Every chapter ends one hour later.", body: "Use reading order to hide what the reader already suspects.", color: "paper-note" },
  ],
});

/** Validators mirror the brief contract: bounded counts, unique names, consistent ranges. */
export function validateBrief(b: Brief): string[] {
  const e: string[] = [];
  if (b.premise.trim().length < 20) e.push("Premise needs at least 20 characters.");
  if (b.chapters < 1 || b.chapters > 40) e.push("Chapters must be between 1 and 40.");
  if (b.scenesPerChapter < 1 || b.scenesPerChapter > 12) e.push("Scenes per chapter must be between 1 and 12.");
  if (b.wordMin < 100 || b.wordMax > 6000 || b.wordMin > b.wordMax) e.push("Scene word range must sit within 100–6000 with min ≤ max.");
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
export const CORPUS = [
  { id: "work_001", title: "The Odyssey", mechanism: "Delayed homecoming", tags: ["journey", "disguise", "loyalty", "return"], collection: "Homeric", text: "A hero returns in disguise and tests who stayed loyal." },
  { id: "work_002", title: "The Iliad", mechanism: "Wrath as engine", tags: ["war", "grief", "honour", "troy"], collection: "Homeric", text: "A withdrawn warrior's anger reshapes the fate of a city." },
  { id: "work_003", title: "Faust", mechanism: "Tempting bargain", tags: ["bargain", "temptation", "knowledge", "damnation"], collection: "German drama", text: "A scholar trades his soul for experience and pays in others' ruin." },
  { id: "tale_014", title: "Little Red Cap", mechanism: "Trusted path betrayed", tags: ["forest", "wolf", "disguise", "warning"], collection: "Grimm", text: "A familiar road becomes dangerous when a stranger offers help." },
  { id: "tale_021", title: "Bluebeard", mechanism: "Forbidden room", tags: ["secret", "marriage", "curiosity", "warning"], collection: "Perrault", text: "A single prohibition makes the reader complicit in discovery." },
  { id: "work_008", title: "The Trojan Women", mechanism: "Aftermath chorus", tags: ["troy", "grief", "women", "war"], collection: "Greek tragedy", text: "Survivors narrate catastrophe after the battle is over." },
  { id: "work_011", title: "Agamemnon", mechanism: "Unheeded prophecy", tags: ["prophecy", "cassandra", "return", "doom"], collection: "Greek tragedy", text: "A seer describes the murder no one will prevent." },
  { id: "episode_03", title: "Scheherazade's first night", mechanism: "Story as survival", tags: ["frame", "delay", "storytelling", "survival"], collection: "Thousand and One Nights", text: "Each unfinished story buys one more day." },
];
