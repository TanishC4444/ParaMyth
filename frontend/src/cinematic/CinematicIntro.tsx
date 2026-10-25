import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Artwork } from "../art";
import Storybook, { type BookActions } from "./Storybook";
import { SCENES } from "./scenes";
import { chapterMotion, readNavigation, saveNavigation, sceneAt, scrollProgress } from "./motion";
import "./cinematic.css";

export type IntroActions = { replay: () => void; enter: (animate?: boolean) => void; scene: (index: number) => void; syncWorld: () => void };
type Controller = IntroActions & { refresh: () => void; restore: () => void; scene: (index: number) => void };
type Props = { atlasRef: RefObject<HTMLElement | null>; actionsRef: RefObject<IntroActions | null>; active: boolean; focusAtlas: boolean; reduceMotion: boolean; onBookChange?: (visible: boolean) => void; onPrepareAtlas?: () => void };

export default function CinematicIntro({ atlasRef, actionsRef, active, focusAtlas, reduceMotion, onBookChange, onPrepareAtlas }: Props) {
  const root = useRef<HTMLElement>(null);
  const book = useRef<BookActions>(null);
  const progress = useRef(0);
  const bookmark = useRef(0);
  const callbacks = useRef({ active, onBookChange, onPrepareAtlas }); callbacks.current = { active, onBookChange, onPrepareAtlas };
  const controls = useRef<Controller>(null);
  const [scene, setScene] = useState(0);
  const [systemReduced, setSystemReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const reduced = systemReduced || reduceMotion;
  const reducedRef = useRef(reduced); reducedRef.current = reduced;
  useImperativeHandle(actionsRef, () => ({ enter: animate => controls.current?.enter(animate), replay: () => controls.current?.replay(), scene: index => controls.current?.scene(index), syncWorld: () => controls.current?.syncWorld() }), []);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setSystemReduced(preference.matches);
    preference.addEventListener("change", change);
    return () => preference.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const section = root.current!, atlas = atlasRef.current!, shell = section.closest<HTMLElement>(".cinematic-landing")!;
    const footer = shell.querySelector<HTMLElement>(".landing-footer");
    let frame = 0, lastMemory = "", saveTimer = 0;
    let pendingMemory = { view: "book" as "book" | "atlas", bookProgress: 0 };
    const values = new Map<string, number>();
    const flushMemory = () => { window.clearTimeout(saveTimer); saveNavigation(pendingMemory); };
    let geometry = { top: 0, height: 1, viewport: innerHeight };
    let focusWorld = false;
    const measure = () => {
      if (!section.offsetHeight) return;
      geometry = { top: section.getBoundingClientRect().top + scrollY, height: section.offsetHeight, viewport: innerHeight };
    };
    const saved = readNavigation();
    bookmark.current = saved?.bookProgress ?? bookmark.current;
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
    const bounds = () => geometry;
    const paint = () => {
      frame = 0;
      if (!callbacks.current.active) return;
      const { top, height } = bounds();
      const p = scrollProgress(scrollY, top, height, innerHeight);
      progress.current = p;
      if (p > .88) callbacks.current.onPrepareAtlas?.();
      const inBook = p < .9995;
      Object.entries(chapterMotion(p)).forEach(([key, value]) => { if (values.get(key) !== value) { values.set(key, value); shell.style.setProperty(`--${key}`, String(value)); } });
      shell.style.setProperty("--progress", String(p));
      if (shell.dataset.intro !== String(inBook)) callbacks.current.onBookChange?.(inBook);
      shell.dataset.intro = String(inBook);
      shell.dataset.reduced = String(reducedRef.current);
      section.dataset.progress = p.toFixed(4);
      section.dataset.finished = String(!inBook);
      section.inert = !inBook;
      atlas.inert = inBook;
      if (footer) footer.inert = inBook;
      if (inBook) atlas.setAttribute("aria-hidden", "true"); else atlas.removeAttribute("aria-hidden");
      if (p <= .72) bookmark.current = p;
      const memory = JSON.stringify({ view: inBook ? "book" : "atlas", bookProgress: Math.round(bookmark.current * 1000) / 1000 });
      if (memory !== lastMemory) { lastMemory = memory; pendingMemory = JSON.parse(memory); window.clearTimeout(saveTimer); saveTimer = window.setTimeout(flushMemory, 180); }
      setScene(sceneAt(p));
      book.current?.redraw();
    };
    const refresh = () => { if (!frame) frame = requestAnimationFrame(paint); };
    const place = (p: number, focus: boolean) => {
      measure();
      const { top, height } = bounds();
      window.scrollTo({ top: top + Math.max(0, height - innerHeight) * p, behavior: "instant" });
      paint();
      if (focus) (p >= 1 ? atlas : section).focus({ preventScroll: true });
    };
    const jumpToWorld = () => {
      const page = atlas.querySelector<HTMLElement>(".atlas-page");
      if (!page) return;
      window.scrollTo({ top: page.getBoundingClientRect().top + scrollY - 78, behavior: "instant" });
      focusWorld = false; paint(); atlas.focus({ preventScroll: true });
    };
    const enter = (animate = true) => {
      focusWorld = true;
      if (!animate || reducedRef.current || progress.current >= .9995) { place(1, true); jumpToWorld(); return; }
      // An explicit Atlas click traverses the reveal. Returning visits skip it.
      if (progress.current < .70) place(.70, false);
      const { top, height } = bounds();
      window.scrollTo({ top: top + height - innerHeight, behavior: "smooth" });
    };
    const finishNavigation = () => {
      if (!focusWorld) return;
      paint();
      if (progress.current >= .9995) jumpToWorld(); else focusWorld = false;
    };
    const replay = () => place(bookmark.current, true);
    const restore = () => {
      const memory = readNavigation();
      if (focusAtlas || memory?.view === "atlas") enter(false); else place(memory?.bookProgress ?? 0, false);
    };
    controls.current = { enter, replay, refresh, restore, syncWorld: () => { measure(); if (focusWorld && progress.current >= .9995) jumpToWorld(); refresh(); }, scene: index => place(Math.min(.72, index * .12 + .025), false) };
    window.addEventListener("scroll", refresh, { passive: true });
    window.addEventListener("pagehide", flushMemory);
    window.addEventListener("scrollend", finishNavigation);
    const resize = () => {
      const inAtlas = shell.dataset.intro === "false";
      const pastBook = Math.max(0, scrollY - geometry.top - geometry.height + geometry.viewport);
      measure();
      if (inAtlas) { window.scrollTo({ top: geometry.top + geometry.height - innerHeight + pastBook, behavior: "instant" }); paint(); }
      else place(progress.current, false);
    };
    const observer = new ResizeObserver(() => { if (shell.dataset.intro !== "false") measure(); });
    observer.observe(atlas);
    measure();
    window.addEventListener("resize", resize);
    restore();
    return () => {
      flushMemory(); window.removeEventListener("scrollend", finishNavigation); window.removeEventListener("pagehide", flushMemory); observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("scroll", refresh); window.removeEventListener("resize", resize);
      history.scrollRestoration = previousRestoration;
      atlas.inert = false; atlas.removeAttribute("aria-hidden"); if (footer) footer.inert = false;
      controls.current = null;
    };
  }, [atlasRef]);
  useEffect(() => { controls.current?.refresh(); book.current?.redraw(); }, [reduced]);
  useEffect(() => { if (!active) saveNavigation({ view: root.current?.dataset.finished === "true" ? "atlas" : "book", bookProgress: bookmark.current }); if (active) { if (focusAtlas) controls.current?.enter(); else controls.current?.restore(); } }, [active, focusAtlas]);
  return <section ref={root} tabIndex={-1} className="cinematic-intro" aria-label="Illustrated storybook">
    <div className="cinema-stage">
      <div className="book-masthead"><h1 className="paramyth-wordmark" aria-label="ParaMyth">Para<em>Myth</em></h1></div>
      <div className="scene-notes notes-left">
        {SCENES.map((item, i) => <article className="scene-note" key={item.label} aria-hidden={scene !== i} style={{ "--reveal": `var(--scene${i})` } as CSSProperties}>
          <span className="scene-kicker">{String(i + 1).padStart(2, "0")} / {item.label}</span>
          <h2>{item.leftTitle}</h2><p>{item.leftText}</p>
          <Artwork name={item.left} variant="book" className="scene-thumbnail" eager={i === 0} />
        </article>)}
      </div>
      <Storybook progress={progress} actionsRef={book} scene={scene} reduced={reduced} />
      <div className="scene-notes notes-right">
        {SCENES.map((item, i) => <article className="scene-note" key={item.label} aria-hidden={scene !== i} style={{ "--reveal": `var(--scene${i})` } as CSSProperties}>
          <span className="scene-kicker">On the facing page</span>
          <h2>{item.rightTitle}</h2><p>{item.rightText}</p>
          <Artwork name={item.right} variant="book" className="scene-thumbnail" eager={i === 0} />
        </article>)}
      </div>
      <div className="book-horizon" aria-hidden="true" />
      <nav className="book-chapters" aria-label="Book scenes">{SCENES.map((item, i) => <button key={item.label} aria-current={scene === i ? "step" : undefined} onClick={() => controls.current?.scene(i)} aria-label={`Scene ${i + 1}: ${item.label}`}><Artwork name={item.left} variant="book" eager={i < 2} /><span>{item.label}</span></button>)}</nav>
    </div>
  </section>;
}
