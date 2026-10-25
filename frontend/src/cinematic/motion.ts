export const NAV_KEY = "paramyth-navigation-v3";
export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const smooth = (a: number, b: number, value: number) => {
  const t = clamp((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export function scrollProgress(scroll: number, top: number, height: number, viewport: number) {
  return clamp((scroll - top) / Math.max(1, height - viewport));
}
export function pageTurn(progress: number, index: number) {
  return smooth(.08 + index * .12, .145 + index * .12, progress);
}
export function sceneAt(progress: number) {
  return Math.min(5, Math.max(0, Math.floor((progress + .015) / .12)));
}
export function chapterMotion(p: number) {
  const captions = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [
    `scene${i}`, (i === 0 ? 1 : smooth(i * .12 - .008, i * .12 + .015, p)) * (1 - smooth((i + 1) * .12 - .03, (i + 1) * .12 - .009, p)),
  ]));
  return {
    open: 1, collapse: smooth(.72, .91, p), hero: 1 - smooth(.73, .87, p),
    book: 1 - smooth(.89, .98, p), earth: smooth(.82, .98, p), atlas: smooth(.82, .98, p),
    horizon: smooth(.77, .91, p) * (1 - smooth(.95, 1, p)), controls: smooth(.94, 1, p),
    turn: Math.max(...Array.from({ length: 5 }, (_, i) => Math.sin(Math.PI * pageTurn(p, i)))),
    ...Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`leaf${i}`, pageTurn(p, i)])),
    ...captions,
  };
}
export type NavigationMemory = { view: "book" | "atlas"; bookProgress: number };
export function readNavigation(): NavigationMemory | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(NAV_KEY) || "null");
    if (!value || !["book", "atlas"].includes(value.view) || !Number.isFinite(value.bookProgress)) return null;
    return { view: value.view, bookProgress: clamp(value.bookProgress, 0, .72) };
  } catch { return null; }
}
export function saveNavigation(value: NavigationMemory) {
  try { sessionStorage.setItem(NAV_KEY, JSON.stringify(value)); } catch { /* Storage is optional. */ }
}
