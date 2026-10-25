import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createTimeline, stagger } from "animejs";
import Storybook from "./Storybook";
import StoryParticles from "./StoryParticles";
import TitleReveal from "./TitleReveal";
import Astrolabe from "./Astrolabe";
import { hasSeenIntro, phaseAt, rememberIntro, scrollProgress, SCROLL_DURATION } from "./motion";
import "./cinematic.css";

export type IntroActions = { replay: () => void };
type Props = { atlasRef: RefObject<HTMLElement | null>; actionsRef: RefObject<IntroActions | null>; active: boolean; focusAtlas: boolean; reduceMotion: boolean };
export default function CinematicIntro({ atlasRef, actionsRef, active, focusAtlas, reduceMotion }: Props) {
  const root = useRef<HTMLElement>(null);
  const [systemReduced, setSystemReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches || !CSS.supports("transform-style", "preserve-3d"));
  const reduced = systemReduced || reduceMotion;
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState("book");
  const progress = useRef(0);
  const firstVisit = useRef(!hasSeenIntro() && !focusAtlas);
  const wasActive = useRef(active);
  const activeRef = useRef(active); activeRef.current = active;
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const controls = useRef<{ skip: (focus?: boolean) => void; refresh: () => void; replay: () => void } | null>(null);
  useImperativeHandle(actionsRef, () => ({ replay: () => { setPaused(false); controls.current?.replay(); } }), []);

  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setSystemReduced(preference.matches || !CSS.supports("transform-style", "preserve-3d"));
    preference.addEventListener("change", changed);
    return () => preference.removeEventListener("change", changed);
  }, []);

  useEffect(() => {
    const section = root.current!, atlas = atlasRef.current!;
    let frame = 0, disposed = false, lastPhase = "book", settled = false;
    const find = (selector: string) => section.querySelector<HTMLElement>(selector)!;
    const rail = find(".cinema-rail-fill");
    const skip = (focus = true) => {
      settle(); rememberIntro();
      scroll.seek(SCROLL_DURATION, true);
      atlas.inert = false; atlas.removeAttribute("aria-hidden");
      const top = atlas.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top, behavior: "instant" }); update();
      if (focus) atlas.focus({ preventScroll: true });
    };
    if (reduced) {
      setReady(true); setPhase("book");
      atlas.style.opacity = "1"; atlas.inert = false; atlas.removeAttribute("aria-hidden");
      controls.current = { skip: (focus = true) => { rememberIntro(); atlas.scrollIntoView({ behavior: "instant" }); if (focus) atlas.focus({ preventScroll: true }); }, refresh: () => {}, replay: () => section.scrollIntoView({ behavior: "instant" }) };
      if (!firstVisit.current && activeRef.current) controls.current.skip(false);
      return () => { controls.current = null; atlas.style.removeProperty("opacity"); };
    }

    const opening = createTimeline({ autoplay: false, defaults: { ease: "inOutSine" }, onComplete: () => { settled = true; firstVisit.current = false; setReady(true); rememberIntro(); } })
      .add(find(".storybook-assembly"), { opacity: [0, 1], y: [70, 0], x: ["-14%", "0%"], rotateX: [46, 28], rotateZ: [-12, -5], duration: 1800 }, 0)
      .add(find(".book-cover"), { rotateY: [0, -178], duration: 1600 }, 650)
      .add(find(".book-left-block"), { opacity: [0, 1], duration: 800 }, 1000)
      .add(find(".book-cover"), { zIndex: [8, 0], duration: 1 }, 2300);
    [0, 1, 2].forEach((i) => {
      opening.add(find(`.book-leaf-${i}`), { rotateY: [0, -177 + i * .7], duration: 1450 + i * 110 }, 2750 + i * 2000)
        .add(find(`.book-leaf-${i}`), { zIndex: [6 - i, i + 1], duration: 1 }, 4210 + i * 2100);
    });
    opening.add(find(".cinema-astrolabe"), { opacity: [0, 1], duration: 2600, ease: "outCubic" }, 0)
      .add(section.querySelectorAll(".cinema-opening-copy > *"), { opacity: [0, 1], y: [18, 0], duration: 1100, delay: stagger(180), ease: "outCubic" }, 200)
      .add(section.querySelectorAll(".book-illustration .art-image"), { scale: [1.06, 1], duration: 8500, ease: "linear" }, 0);

    const scroll = createTimeline({ autoplay: false, defaults: { ease: "inOutSine" } })
      .add(find(".storybook-exit"), { scale: [1, .5], y: [0, -100], opacity: [1, 0], duration: 1000 }, 120)
      .add(find(".cinema-opening-copy"), { opacity: [1, 0], y: [0, -20], duration: 450 }, 50)
      .add(find(".cinema-scroll-cue"), { opacity: [1, 0], duration: 400 }, 100)
      .add(find(".cinema-title-reveal"), { opacity: [0, 1], duration: 400 }, 950)
      .add(section.querySelectorAll(".cinema-letter"), { opacity: [0, 1], y: [48, 0], rotateX: [-70, 0], filter: ["blur(10px)", "blur(0px)"], duration: 650, delay: stagger(60), ease: "outCubic" }, 950)
      .add(section.querySelectorAll(".cinema-flourish path"), { strokeDashoffset: [1, 0], duration: 700, ease: "inOutQuad" }, 1300)
      .add(find(".cinema-astrolabe svg"), { rotate: [0, 72], duration: SCROLL_DURATION, ease: "linear" }, 0)
      .add(find(".cinema-astrolabe"), { scale: [1, 1.35], duration: SCROLL_DURATION, ease: "linear" }, 0)
      .add(find(".cinema-title-reveal"), { opacity: 0, y: [0, -65], duration: 450 }, 2150)
      .add(find(".dial-tilt"), { opacity: [1, 0], duration: 500 }, 2200)
      .add(find(".cinema-atmosphere"), { opacity: [1, 0], duration: 900 }, 2300)
      .add(atlas, { opacity: [0, 1], translateY: [35, 0], scale: [.97, 1], duration: 600 }, 2600);
    function settle() {
      if (settled) return;
      opening.seek(opening.duration, true).pause(); settled = true; firstVisit.current = false; setReady(true); rememberIntro();
    }
    function update() {
      frame = 0;
      if (disposed || !activeRef.current || document.hidden) return;
      const rect = section.getBoundingClientRect();
      if (!rect.height) return;
      const p = scrollProgress(window.scrollY, rect.top + window.scrollY, rect.height, window.innerHeight);
      if (p > .012) settle();
      progress.current = p; scroll.seek(p * SCROLL_DURATION, true);
      rail.style.transform = `scaleY(${p.toFixed(4)})`;
      atlas.inert = p < .92;
      if (atlas.inert) atlas.setAttribute("aria-hidden", "true"); else atlas.removeAttribute("aria-hidden");
      const nextPhase = phaseAt(p);
      section.dataset.progress = p.toFixed(3);
      if (nextPhase !== lastPhase) { lastPhase = nextPhase; setPhase(nextPhase); }
      if (p >= .98) rememberIntro();
    }
    const requestUpdate = () => { if (!frame && activeRef.current) frame = requestAnimationFrame(update); };
    const refresh = () => {
      if (!activeRef.current || pausedRef.current || document.hidden) opening.pause();
      else if (!settled) opening.resume();
      requestUpdate();
    };
    const replay = () => {
      window.scrollTo({ top: section.getBoundingClientRect().top + window.scrollY, behavior: "instant" });
      settled = false; setReady(false); opening.restart(); update(); section.focus({ preventScroll: true });
    };
    controls.current = { skip, refresh, replay };
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    document.addEventListener("visibilitychange", refresh);
    if (!firstVisit.current) { settle(); if (activeRef.current) skip(false); }
    else refresh();
    update();
    return () => {
      disposed = true; cancelAnimationFrame(frame); opening.revert(); scroll.revert();
      window.removeEventListener("scroll", requestUpdate); window.removeEventListener("resize", requestUpdate); document.removeEventListener("visibilitychange", refresh);
      atlas.inert = false; atlas.removeAttribute("aria-hidden"); controls.current = null;
    };
  }, [reduced, atlasRef]);

  useLayoutEffect(() => {
    if (active && (focusAtlas || !wasActive.current)) controls.current?.skip(false);
    wasActive.current = active;
    controls.current?.refresh();
  }, [active, focusAtlas]);
  useEffect(() => { controls.current?.refresh(); }, [paused]);

  return <section ref={root} tabIndex={-1} className={`cinematic-intro${reduced ? " cinematic-static" : ""}`} data-phase={phase} aria-label="Enter the world of ParaMyth">
    <div className="cinema-stage">
      <div className="cinema-atmosphere" aria-hidden="true"><div className="cinema-glow glow-a" /><div className="cinema-glow glow-b" /><div className="cinema-glow glow-c" /><div className="cinema-grain" /></div>
      <Astrolabe />
      <div className="cinema-opening-copy"><p className="cinema-eyebrow">385 tales · 11 traditions · one atlas</p><p className="cinema-prologue">Every story begins<br /><em>somewhere.</em></p></div>
      <Storybook />
      {!reduced && <StoryParticles progress={progress} running={active && !paused && phase !== "atlas"} />}
      <TitleReveal />
      <div className="cinema-controls"><button onClick={() => controls.current?.skip()}>Skip intro <span aria-hidden="true">↗</span></button>{!reduced && <button onClick={() => setPaused(!paused)} aria-pressed={paused}>{paused ? "Resume animation" : "Pause animation"}</button>}</div>
      <button className="cinema-scroll-cue" onClick={() => reduced ? controls.current?.skip() : window.scrollTo({ top: (root.current?.getBoundingClientRect().top || 0) + window.scrollY + (root.current!.offsetHeight - window.innerHeight) * .5, behavior: paused ? "instant" : "smooth" })}>
        <span>{reduced ? "Explore the story atlas" : ready ? "Scroll to open the atlas" : "Watch the pages turn"}</span><i aria-hidden="true"><b /></i>
      </button>
      <div className="cinema-rail" aria-hidden="true">
        <span className="cinema-rail-track"><span className="cinema-rail-fill" /></span>
        <ol>{[["I", "The opening", "book"], ["II", "The name", "title"], ["III", "The atlas", "transition"]].map(([n, label, key]) => <li key={key} className={phase === key || (key === "transition" && phase === "atlas") ? "on" : ""}><b>{n}</b><span>{label}</span></li>)}</ol>
      </div>
    </div>
  </section>;
}
