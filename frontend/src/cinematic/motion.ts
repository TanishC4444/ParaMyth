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

/** The same reversible chapter curve drives the book, orbit and globe. */
export function chapterMotion(p: number) {
  const ramp = (a: number, b: number) => { const t = clamp((p - a) / (b - a)); return t * t * (3 - 2 * t); };
  const burst = ramp(.06, .27) * (1 - ramp(.32, .55));
  return {
    burst,
    unfold: ramp(.28, .57),
    hero: 1 - ramp(.03, .23),
    book: 1 - ramp(.61, .74),
    orbit: 1 - ramp(.27, .5),
    earth: ramp(.58, .73) * (1 - ramp(.91, 1)),
    worldcopy: ramp(.67, .77) * (1 - ramp(.86, .96)),
    zoom: ramp(.78, .97),
    atlas: ramp(.89, .99),
    warmth: ramp(.1, .35) * (1 - ramp(.56, .78)),
  };
}
