import corpusIndex from "./atlas-index.json";
import type { AtlasApproach, AtlasIndex, AtlasPin, AtlasSource, AtlasStory, CreativeSeed } from "./types";

/** Where atlas records came from: the studio API reading literary_rag.db, or the bundled export of it. */
export type AtlasOrigin = { kind: "api"; base: string } | { kind: "snapshot" };

const json = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  // Static dev servers answer unknown routes with index.html, so insist on JSON.
  if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
};

const apiBases = () => {
  let stored = "";
  try { stored = (localStorage.getItem("paramyth-api-base") || "").replace(/\/$/, ""); } catch { /* optional */ }
  // Same origin first: the studio launcher serves this app and the API together.
  // Static hosting has no API at its own origin, so only a chosen base is tried.
  const own = import.meta.env.VITE_STATIC_SITE === "1" ? [] : [""];
  return [...new Set([...own, stored].filter((b, i) => b || (i === 0 && own.length)))];
};

let snapshot: Promise<{ corpus: string; regions: string[]; stories: AtlasStory[] }> | null = null;
const loadSnapshot = () => (snapshot ??= json<{ corpus: string; regions: string[]; stories: AtlasStory[] }>(`${import.meta.env.BASE_URL}atlas/stories.json`).catch((error) => { snapshot = null; throw error; }));
export const bundledAtlas = { index: corpusIndex as AtlasIndex, origin: { kind: "snapshot" } as AtlasOrigin };

export async function loadAtlas(): Promise<{ index: AtlasIndex; origin: AtlasOrigin }> {
  for (const base of apiBases()) {
    try {
      const index = await json<AtlasIndex>(`${base}/api/v1/atlas/stories`);
      if (Array.isArray(index.stories) && index.stories.length && Array.isArray(index.regions)) return { index, origin: { kind: "api", base } };
    } catch { /* Keep the bundled corpus visible while the live service is offline. */ }
  }
  return bundledAtlas;
}

export async function loadStory(id: string, origin: AtlasOrigin): Promise<AtlasStory> {
  // The shipped export is real corpus data and works without the studio service.
  const story = (await loadSnapshot().catch(() => null))?.stories.find((s) => s.id === id);
  if (!story && origin.kind === "api") return json<AtlasStory>(`${origin.base}/api/v1/atlas/stories/${encodeURIComponent(id)}`);
  if (!story) throw new Error(`No mapped story ${id}`);
  return story;
}

/** snake_case corpus tags -> "Sentence case". */
export const label = (tag: string) => { const s = tag.replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };

/** Muted cartographic inks, one per tradition region. */
export const REGION_INK: Record<string, string> = {
  "British Isles": "#4f7a5a",
  "Germanic Europe": "#7d5a43",
  "Nordic & Baltic": "#45698c",
  "Southern & Western Europe": "#b07a2e",
  "Slavic Europe": "#8c4659",
  "Greece & Rome": "#2f6f8f",
  "Near East & Egypt": "#b0603a",
  "Persia & Central Asia": "#2f7d76",
  "South Asia": "#c0503a",
  "East Asia": "#6a5893",
  "Americas": "#58743a",
};
export const ink = (region: string) => REGION_INK[region] || "#203970";

export const matches = (s: AtlasPin, q: string) => {
  const t = q.trim().toLowerCase();
  return !t || [s.title, s.tradition, s.place, s.attribution, s.mechanism, ...s.themes].join(" ").toLowerCase().replace(/_/g, " ").includes(t);
};

/** Builds the creative-workspace hand-off. Retelling keeps the source; "Inspired by" carries only its engine. */
export function seedFor(story: AtlasStory, approach: AtlasApproach): CreativeSeed {
  const source: AtlasSource = { id: story.id, title: story.title, tradition: story.tradition, place: story.place, approach, mechanism: story.mechanism, instruction: story.instruction, analysis: story.analysis };
  const input = approach === "Retelling"
    ? `A retelling of ${story.title} (${story.tradition}). Keep its engine (${label(story.mechanism).toLowerCase()}). ${story.analysis} Decide whose version this is, and what it changes about the familiar ending.`
    : `An original story that borrows only the engine of ${story.title}: ${story.instruction} New characters, world and stakes, with no names, places or plot beats from the source.`;
  return { mode: "Ideas", input, source };
}
