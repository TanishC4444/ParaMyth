import { useEffect, useImperativeHandle, useRef, useState, type RefObject } from "react";
import Storybook from "./Storybook";
import { chapterMotion, advanceScene } from "./motion";
import "./cinematic.css";

export type IntroActions = { replay: () => void; enter: () => void };
type Playback = IntroActions & { wake: () => void; reverse: () => void; seek: (value: number) => void; play: () => void };
type Props = { atlasRef: RefObject<HTMLElement | null>; actionsRef: RefObject<IntroActions | null>; active: boolean; focusAtlas: boolean; reduceMotion: boolean; worldReady: boolean; onBookChange?: (visible: boolean) => void };

export default function CinematicIntro({ atlasRef, actionsRef, active, focusAtlas, reduceMotion, worldReady, onBookChange }: Props) {
  const root = useRef<HTMLElement>(null);
  const sceneChange = useRef(onBookChange); sceneChange.current = onBookChange;
  const slider = useRef<HTMLInputElement>(null);
  const progress = useRef(focusAtlas ? 1 : 0);
  const direction = useRef<1 | -1>(1);
  const pausedRef = useRef(false), entering = useRef(false);
  const activeRef = useRef(active); activeRef.current = active;
  const readyRef = useRef(worldReady); readyRef.current = worldReady;
  const [paused, setPaused] = useState(false);
  const [backwards, setBackwards] = useState(false);
  const [systemReduced, setSystemReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const reduced = systemReduced || reduceMotion;
  const controls = useRef<Playback | null>(null);
  useImperativeHandle(actionsRef, () => ({ enter: () => controls.current?.enter(), replay: () => controls.current?.replay() }), []);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setSystemReduced(preference.matches);
    preference.addEventListener("change", change);
    return () => preference.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const section = root.current!, atlas = atlasRef.current!, shell = section.closest<HTMLElement>(".cinematic-landing")!;
    const footer = shell.querySelector<HTMLElement>(".landing-footer");
    let frame = 0, last = 0, disposed = false;
    const paint = () => {
      const p = progress.current;
      Object.entries(chapterMotion(p)).forEach(([key, value]) => shell.style.setProperty(`--${key}`, String(value)));
      if (shell.dataset.intro === "true" && p >= 1) window.scrollTo({ top: 0, behavior: "instant" });
      if (shell.dataset.intro !== String(p < 1)) sceneChange.current?.(p < 1);
      shell.dataset.intro = String(p < 1);
      shell.dataset.reduced = String(reduced);
      section.dataset.progress = p.toFixed(3);
      section.dataset.finished = String(p >= 1);
      section.inert = p >= 1;
      atlas.inert = p < 1;
      if (footer) footer.inert = p < 1;
      if (atlas.inert) atlas.setAttribute("aria-hidden", "true"); else atlas.removeAttribute("aria-hidden");
      if (slider.current) slider.current.value = String(Math.round(p * 1000));
      if (p >= 1 && section.contains(document.activeElement)) atlas.focus({ preventScroll: true });
    };
    const start = () => { if (!frame && !disposed) { last = 0; frame = requestAnimationFrame(tick); } };
    const tick = (time: number) => {
      frame = 0;
      const delta = last ? Math.min(time - last, 64) : 0; last = time;
      if (activeRef.current && !document.hidden && !pausedRef.current) {
        const next = reduced ? 1 : advanceScene(progress.current, delta, entering.current, direction.current);
        progress.current = readyRef.current || reduced || direction.current < 0 ? next : Math.min(next, .7);
        paint();
        if (progress.current <= 0 && direction.current < 0) {
          pausedRef.current = true; setPaused(true);
          direction.current = 1; setBackwards(false);
        }
      }
      if (!disposed && activeRef.current && !document.hidden && !pausedRef.current && (direction.current < 0 ? progress.current > 0 : progress.current < 1)) frame = requestAnimationFrame(tick);
    };
    const play = () => {
      pausedRef.current = !pausedRef.current; setPaused(pausedRef.current);
      entering.current = false;
      if (!pausedRef.current) start();
    };
    const reverse = () => {
      direction.current = direction.current === 1 ? -1 : 1; setBackwards(direction.current < 0);
      entering.current = false; pausedRef.current = false; setPaused(false); start();
    };
    const enter = () => {
      direction.current = 1; setBackwards(false); entering.current = true;
      pausedRef.current = false; setPaused(false);
      window.scrollTo({ top: 0, behavior: "instant" });
      if (reduced) { progress.current = 1; paint(); atlas.focus({ preventScroll: true }); } else start();
    };
    const replay = () => {
      if (reduced) {
        progress.current = 0; pausedRef.current = true; setPaused(true);
        window.scrollTo({ top: 0, behavior: "instant" }); paint();
        section.focus({ preventScroll: true }); return;
      }
      // Return along exactly the same path, without resetting the current frame.
      direction.current = -1; setBackwards(true); entering.current = true;
      pausedRef.current = false; setPaused(false);
      window.scrollTo({ top: 0, behavior: "instant" }); paint(); start();
      section.focus({ preventScroll: true });
    };
    const seek = (value: number) => {
      progress.current = reduced ? 1 : Math.max(0, Math.min(readyRef.current ? 1 : .7, value));
      if (progress.current === 0) { direction.current = 1; setBackwards(false); }
      pausedRef.current = true; setPaused(true); entering.current = false; paint();
    };
    controls.current = { enter, replay, reverse, seek, play, wake: start };
    const visibility = () => { last = 0; if (!document.hidden) start(); };
    document.addEventListener("visibilitychange", visibility);
    if (reduced) { direction.current = 1; pausedRef.current = false; setPaused(false); setBackwards(false); }
    if (reduced || focusAtlas) progress.current = 1;
    paint(); start();
    return () => {
      disposed = true; cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", visibility);
      if (footer) footer.inert = false;
      atlas.inert = false; atlas.removeAttribute("aria-hidden"); controls.current = null;
    };
  }, [reduced, atlasRef]);
  useEffect(() => { if (active) { if (focusAtlas) controls.current?.enter(); else controls.current?.wake(); } }, [active, focusAtlas]);
  return <section ref={root} tabIndex={-1} className={`cinematic-intro${paused || !active ? " cinema-paused" : ""}`} aria-label="ParaMyth introduction">
    <div className="cinema-stage">
      <h1 className="paramyth-wordmark" aria-label="ParaMyth">Para<span>Myth</span></h1>
      <Storybook />
      <div className="book-horizon" aria-hidden="true" />
      <div className="intro-playback" role="group" aria-label="Book animation controls">
        <button disabled={reduced} aria-label={backwards ? "Play forward" : "Reverse animation"} aria-pressed={backwards} onClick={() => controls.current?.reverse()}>↶</button>
        <button disabled={reduced} aria-label={paused ? "Resume animation" : "Pause animation"} aria-pressed={paused} onClick={() => controls.current?.play()}>{paused ? "▶" : "Ⅱ"}</button>
        <input disabled={reduced} ref={slider} type="range" min="0" max="1000" step="1" defaultValue="0" aria-label="Animation position" onChange={e => controls.current?.seek(Number(e.target.value) / 1000)} />
        <button className="playback-enter" onClick={() => controls.current?.enter()}>Atlas ↗</button>
      </div>
    </div>
  </section>;
}
