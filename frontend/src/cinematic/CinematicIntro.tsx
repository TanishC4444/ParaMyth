import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Artwork } from "../art";
import Storybook, { type BookActions } from "./Storybook";
import { SCENES } from "./scenes";
import { chapterMotion, readNavigation, saveNavigation, sceneAt, scrollProgress } from "./motion";
import "./cinematic.css";

export type IntroActions = { replay: () => void; enter: () => void; scene: (index: number) => void };
type Controller = IntroActions & { refresh: () => void; restore: () => void; scene: (index: number) => void };
type Props = { atlasRef: RefObject<HTMLElement | null>; actionsRef: RefObject<IntroActions | null>; active: boolean; focusAtlas: boolean; reduceMotion: boolean; onBookChange?: (visible: boolean) => void };

export default function CinematicIntro({ atlasRef, actionsRef, active, focusAtlas, reduceMotion, onBookChange }: Props) {
  const root = useRef<HTMLElement>(null);
  const book = useRef<BookActions>(null);
  const progress = useRef(0);
  const bookmark = useRef(0);
  const callbacks = useRef({ active, onBookChange }); callbacks.current = { active, onBookChange };
  const controls = useRef<Controller>(null);
  const [scene, setScene] = useState(0);
  const [systemReduced, setSystemReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const reduced = systemReduced || reduceMotion;
  const reducedRef = useRef(reduced); reducedRef.current = reduced;
  useImperativeHandle(actionsRef, () => ({ enter: () => controls.current?.enter(), replay: () => controls.current?.replay(), scene: index => controls.current?.scene(index) }), []);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setSystemReduced(preference.matches);
    preference.addEventListener("change", change);
    return () => preference.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const section = root.current!, atlas = atlasRef.current!, shell = section.closest<HTMLElement>(".cinematic-landing")!;
    const footer = shell.querySelector<HTMLElement>(".landing-footer");
    let frame = 0;
    const saved = readNavigation();
    bookmark.current = saved?.bookProgress ?? bookmark.current;
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
    const bounds = () => ({ top: section.getBoundingClientRect().top + scrollY, height: section.offsetHeight });
    const paint = () => {
      frame = 0;
      if (!callbacks.current.active) return;
      const { top, height } = bounds();
      const p = scrollProgress(scrollY, top, height, innerHeight);
      progress.current = p;
      const inBook = p < .9995;
      Object.entries(chapterMotion(p)).forEach(([key, value]) => shell.style.setProperty(`--${key}`, String(value)));
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
      saveNavigation({ view: inBook ? "book" : "atlas", bookProgress: bookmark.current });
      setScene(sceneAt(p));
      book.current?.redraw();
    };
    const refresh = () => { if (!frame) frame = requestAnimationFrame(paint); };
    const place = (p: number, focus: boolean) => {
      const { top, height } = bounds();
      window.scrollTo({ top: top + Math.max(0, height - innerHeight) * p, behavior: "instant" });
      paint();
      if (focus) (p >= 1 ? atlas : section).focus({ preventScroll: true });
    };
    const enter = () => place(1, true);
    const replay = () => place(bookmark.current, true);
    const restore = () => {
      const memory = readNavigation();
      place(focusAtlas || memory?.view === "atlas" ? 1 : memory?.bookProgress ?? 0, false);
    };
    controls.current = { enter, replay, refresh, restore, scene: index => place(Math.min(.72, index * .12 + .025), false) };
    window.addEventListener("scroll", refresh, { passive: true });
    const resize = () => place(shell.dataset.intro === "false" ? 1 : progress.current, false);
    window.addEventListener("resize", resize);
    restore();
    return () => {
      cancelAnimationFrame(frame); window.removeEventListener("scroll", refresh); window.removeEventListener("resize", resize);
      history.scrollRestoration = previousRestoration;
      atlas.inert = false; atlas.removeAttribute("aria-hidden"); if (footer) footer.inert = false;
      controls.current = null;
    };
  }, [atlasRef]);
  useEffect(() => { controls.current?.refresh(); book.current?.redraw(); }, [reduced]);
  useEffect(() => { if (active) { if (focusAtlas) controls.current?.enter(); else controls.current?.restore(); } }, [active, focusAtlas]);
  return <section ref={root} tabIndex={-1} className="cinematic-intro" aria-label="Illustrated storybook">
    <div className="cinema-stage">
      <div className="book-masthead"><h1 className="paramyth-wordmark" aria-label="ParaMyth">Para<em>Myth</em></h1><span className="book-edition">An illustrated atlas of stories</span></div>
      <div className="scene-notes notes-left">
        {SCENES.map((item, i) => <article className="scene-note" key={item.label} aria-hidden={scene !== i} style={{ "--reveal": `var(--scene${i})` } as CSSProperties}>
          <span className="scene-kicker">{String(i + 1).padStart(2, "0")} / {item.label}</span>
          <h2>{item.leftTitle}</h2><p>{item.leftText}</p>
          <Artwork name={item.left} className="scene-thumbnail" eager={i === 0} />
        </article>)}
      </div>
      <Storybook progress={progress} actionsRef={book} scene={scene} reduced={reduced} />
      <div className="scene-notes notes-right">
        {SCENES.map((item, i) => <article className="scene-note" key={item.label} aria-hidden={scene !== i} style={{ "--reveal": `var(--scene${i})` } as CSSProperties}>
          <span className="scene-kicker">On the facing page</span>
          <h2>{item.rightTitle}</h2><p>{item.rightText}</p>
          <Artwork name={item.right} className="scene-thumbnail" eager={i === 0} />
        </article>)}
      </div>
      <div className="book-horizon" aria-hidden="true" />
      <nav className="book-chapters" aria-label="Book scenes">{SCENES.map((item, i) => <button key={item.label} aria-current={scene === i ? "step" : undefined} onClick={() => controls.current?.scene(i)} aria-label={`Scene ${i + 1}: ${item.label}`}><Artwork name={item.left} eager={i < 2} /><span>{item.label}</span></button>)}</nav>
    </div>
  </section>;
}
