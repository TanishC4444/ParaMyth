import { useEffect, useImperativeHandle, useRef, useState, type RefObject } from "react";
import Storybook from "./Storybook";
import { Artwork } from "../art";
import { chapterMotion, advanceScene } from "./motion";
import "./cinematic.css";

export type IntroActions = { replay: () => void; enter: () => void };
type Props = { atlasRef: RefObject<HTMLElement | null>; actionsRef: RefObject<IntroActions | null>; active: boolean; focusAtlas: boolean; reduceMotion: boolean; worldReady: boolean };

export default function CinematicIntro({ atlasRef, actionsRef, active, focusAtlas, reduceMotion, worldReady }: Props) {
  const root = useRef<HTMLElement>(null);
  const readyRef = useRef(worldReady); readyRef.current = worldReady;
  const progress = useRef(focusAtlas ? 1 : 0);
  const activeRef = useRef(active); activeRef.current = active;
  const pausedRef = useRef(false);
  const entering = useRef(false);
  const focusOnComplete = useRef(false);
  const [paused, setPaused] = useState(false);
  const [systemReduced, setSystemReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const reduced = systemReduced || reduceMotion;
  const controls = useRef<IntroActions | null>(null);
  useImperativeHandle(actionsRef, () => ({ enter: () => controls.current?.enter(), replay: () => controls.current?.replay() }), []);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setSystemReduced(preference.matches);
    preference.addEventListener("change", change);
    return () => preference.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const section = root.current!, atlas = atlasRef.current!, shell = section.closest<HTMLElement>(".cinematic-landing")!;
    let frame = 0, last = 0, disposed = false;
    const paint = () => {
      const p = progress.current;
      const state = chapterMotion(p);
      Object.entries(state).forEach(([key, value]) => shell.style.setProperty(`--${key}`, String(value)));
      shell.dataset.intro = String(p < 1);
      shell.dataset.reduced = String(reduced);
      section.dataset.pastHero = String(p >= .52);
      section.dataset.progress = p.toFixed(3);
      section.dataset.finished = String(p >= 1);
      section.inert = p >= 1;
      atlas.inert = p < .94;
      if (atlas.inert) atlas.setAttribute("aria-hidden", "true"); else atlas.removeAttribute("aria-hidden");
      if (p >= 1 && focusOnComplete.current) {
        focusOnComplete.current = false;
        atlas.focus({ preventScroll: true });
      }
    };
    const start = () => { if (!frame && !disposed) { last = 0; frame = requestAnimationFrame(tick); } };
    const tick = (time: number) => {
      frame = 0;
      const delta = last ? Math.min(time - last, 1000) : 0; last = time;
      if (activeRef.current && !document.hidden && (!pausedRef.current || entering.current)) {
        const next = reduced ? 1 : advanceScene(progress.current, delta, entering.current);
        // Hold at the horizon until the globe is textured (or its fallback is ready).
        progress.current = readyRef.current || reduced ? next : Math.min(next, .5);
        paint();
      }
      if (progress.current < 1 && !disposed) frame = requestAnimationFrame(tick);
    };
    const enter = () => {
      entering.current = true; focusOnComplete.current = true;
      window.scrollTo({ top: 0, behavior: "instant" });
      if (reduced) { progress.current = 1; paint(); } else start();
    };
    const replay = () => {
      entering.current = false; focusOnComplete.current = false; pausedRef.current = false; setPaused(false);
      progress.current = reduced ? 1 : 0;
      window.scrollTo({ top: 0, behavior: "instant" }); paint(); start();
      if (!reduced) section.focus({ preventScroll: true });
    };
    controls.current = { enter, replay };
    // Scroll is never used as the animation timeline.
    const leave = () => { if (progress.current < 1) { entering.current = true; start(); } };
    const key = (e: KeyboardEvent) => { if (["PageDown", "End"].includes(e.key)) leave(); };
    const visibility = () => { last = 0; start(); };
    window.addEventListener("wheel", leave, { passive: true });
    window.addEventListener("touchmove", leave, { passive: true });
    window.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", visibility);
    if (reduced || focusAtlas) progress.current = 1;
    paint(); start();
    return () => {
      disposed = true; cancelAnimationFrame(frame);
      window.removeEventListener("wheel", leave); window.removeEventListener("touchmove", leave); window.removeEventListener("keydown", key); document.removeEventListener("visibilitychange", visibility);
      atlas.inert = false; atlas.removeAttribute("aria-hidden"); controls.current = null;
    };
  }, [reduced, atlasRef]);
  useEffect(() => { if (active && focusAtlas) controls.current?.enter(); }, [active, focusAtlas]);
  return <section ref={root} tabIndex={-1} className={`cinematic-intro${paused || !active ? " cinema-paused" : ""}`} aria-label="ParaMyth introduction">
    <div className="cinema-stage">
      <h1 className="paramyth-wordmark" aria-label="ParaMyth">PARA<span>MYTH</span><i aria-hidden="true" /></h1>
      <div className="cinema-orbits" aria-hidden="true"><div className="orbit-track" />
        <div className="orbit-item orbit-art-one"><Artwork name="castle" eager /></div>
        <div className="orbit-item orbit-art-two"><Artwork name="enchanted" eager /></div>
        <div className="orbit-item orbit-art-three"><Artwork name="moonlight" eager /></div>
      </div>
      <Storybook />
      <div className="book-horizon" aria-hidden="true" />
      <button className="intro-enter" onClick={() => controls.current?.enter()}>Explore atlas <span aria-hidden="true">↗</span></button>
      <button className="intro-pause" aria-label={paused ? "Resume animation" : "Pause animation"} aria-pressed={paused} onClick={() => { pausedRef.current = !paused; setPaused(!paused); }}>{paused ? "▶" : "Ⅱ"}</button>
    </div>
  </section>;
}
