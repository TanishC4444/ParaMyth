export const INTRO_KEY = "paramyth-storybook-seen-v1";
export const SCROLL_DURATION = 3200;
export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export function scrollProgress(scroll: number, top: number, height: number, viewport: number) {
  return clamp((scroll - top) / Math.max(1, height - viewport));
}
export function phaseAt(progress: number) {
  return progress < .3 ? "book" : progress < .68 ? "title" : progress < .98 ? "transition" : "atlas";
}
export function hasSeenIntro() {
  try { return sessionStorage.getItem(INTRO_KEY) === "1"; } catch { return false; }
}
export function rememberIntro() {
  try { sessionStorage.setItem(INTRO_KEY, "1"); } catch { /* Private storage is optional. */ }
}

/** Time based, reversible visual curves. No scene owns or captures page scrolling. */
export function chapterMotion(p: number) {
  const ramp = (a: number, b: number) => { const t = clamp((p - a) / (b - a)); return t * t * (3 - 2 * t); };
  return {
    open: 1,
    leaf0: ramp(.08, .22),
    leaf1: ramp(.25, .39),
    leaf2: ramp(.42, .55),
    turn: Math.max(Math.sin(Math.PI * ramp(.08, .22)), Math.sin(Math.PI * ramp(.25, .39)), Math.sin(Math.PI * ramp(.42, .55))),
    orbitTurn: clamp(p),
    burst: 0,
    collapse: ramp(.55, .76),
    hero: 1 - ramp(.49, .64),
    book: 1 - ramp(.74, .84),
    orbit: 1 - ramp(.51, .7),
    earth: ramp(.73, .95),
    horizon: ramp(.64, .77) * (1 - ramp(.9, 1)),
    atlas: ramp(.73, .95),
    controls: ramp(.88, 1),
  };
}
export function advanceScene(progress: number, deltaMs: number, entering = false, direction: 1 | -1 = 1) {
  return clamp(progress + direction * Math.max(0, deltaMs) / (entering ? 1600 : 18000));
}
