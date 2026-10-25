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
