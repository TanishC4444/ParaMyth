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
    open: ramp(.06, .28),
    burst: ramp(.16, .28) * (1 - ramp(.3, .47)),
    collapse: ramp(.22, .62),
    hero: 1 - ramp(.25, .52),
    book: 1 - ramp(.55, .7),
    orbit: 1 - ramp(.35, .57),
    earth: ramp(.5, .82),
    horizon: ramp(.42, .62) * (1 - ramp(.78, 1)),
    atlas: ramp(.5, .82),
    controls: ramp(.75, 1),
  };
}
export function advanceScene(progress: number, deltaMs: number, entering = false) {
  return clamp(progress + Math.max(0, deltaMs) / (entering ? 900 : 8800));
}
