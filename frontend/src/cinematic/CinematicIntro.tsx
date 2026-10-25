import { useEffect, useImperativeHandle, useRef, useState, type RefObject } from "react";
import Storybook from "./Storybook";
import LandingEarth from "./LandingEarth";
import { Artwork } from "../art";
import { chapterMotion, scrollProgress } from "./motion";
import "./cinematic.css";

export type IntroActions = { replay: () => void; enter: () => void };
type Props = { atlasRef: RefObject<HTMLElement | null>; actionsRef: RefObject<IntroActions | null>; active: boolean; focusAtlas: boolean; reduceMotion: boolean };

export default function CinematicIntro({ atlasRef, actionsRef, active, focusAtlas, reduceMotion }: Props) {
  const root = useRef<HTMLElement>(null);
  const progress = useRef(0);
  const entered = useRef(false);
  const [systemReduced, setSystemReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [paused, setPaused] = useState(false);
  const [chapter, setChapter] = useState(0);
  const reduced = systemReduced || reduceMotion;
  const enter = () => {
    const atlas = atlasRef.current;
    if (!atlas) return;
    entered.current = true;
    atlas.inert = false; atlas.removeAttribute("aria-hidden");
    atlas.style.opacity = "1";
    atlas.scrollIntoView({ behavior: "instant" });
    atlas.focus({ preventScroll: true });
  };
  useImperativeHandle(actionsRef, () => ({
    enter,
    replay: () => { entered.current = false; setPaused(false); root.current?.scrollIntoView({ behavior: "instant" }); root.current?.focus({ preventScroll: true }); },
  }));
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setSystemReduced(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const section = root.current!, atlas = atlasRef.current!;
    const preserveAtlas = atlas.contains(document.activeElement);
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!active) return;
      const rect = section.getBoundingClientRect();
      const p = reduced ? 0 : scrollProgress(window.scrollY, rect.top + window.scrollY, rect.height, window.innerHeight);
      progress.current = p;
      if (p >= .98) entered.current = true;
      if (p < .8) entered.current = false;
      const state = chapterMotion(p);
      Object.entries(state).forEach(([key, value]) => section.style.setProperty(`--${key}`, String(value)));
      section.dataset.progress = p.toFixed(3);
      section.dataset.phase = p < .25 ? "book" : p < .6 ? "pages" : p < .9 ? "world" : "atlas";
      setChapter(p < .25 ? 0 : p < .6 ? 1 : 2);
      atlas.inert = !reduced && !entered.current && p < .9;
      if (atlas.inert) atlas.setAttribute("aria-hidden", "true"); else atlas.removeAttribute("aria-hidden");
      atlas.style.opacity = reduced || entered.current ? "1" : String(state.atlas);
    };
    const requestUpdate = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    update();
    if (preserveAtlas) enter();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", requestUpdate); window.removeEventListener("resize", requestUpdate);
      atlas.inert = false; atlas.removeAttribute("aria-hidden"); atlas.style.removeProperty("opacity");
    };
  }, [active, reduced, atlasRef]);
  useEffect(() => { if (active && focusAtlas) enter(); }, [active, focusAtlas, reduced]);

  return <section ref={root} tabIndex={-1} className={`cinematic-intro${reduced ? " cinematic-static" : ""}${paused || !active ? " cinema-paused" : ""}`} aria-label="The ParaMyth introduction">
    <div className="cinema-stage">
      <div className="cinema-atmosphere" aria-hidden="true"><div className="cinema-world-light" /><div className="cinema-grain" /><div className="cinema-coordinate coordinate-one">38° 02′ N<br />23° 43′ E</div><div className="cinema-coordinate coordinate-two">IMAGINATION<br />HAS A GEOGRAPHY.</div></div>
      <div className="cinema-opening-copy"><p className="cinema-eyebrow">AN ATLAS OF STORIES. A SPACE TO MAKE YOUR OWN.</p><h1 className="paramyth-wordmark" aria-label="ParaMyth">Para<span>Myth</span><sup aria-hidden="true">✳</sup></h1><p className="cinema-prologue">The world is made of <em>stories.</em></p></div>
      <div className="cinema-orbits" aria-hidden="true">
        <div className="orbit-track track-one" /><div className="orbit-track track-two" />
        <div className="orbit-item orbit-art-one"><Artwork name="castle" eager /><span>01 — THE PLACES</span></div>
        <div className="orbit-item orbit-art-two"><Artwork name="enchanted" eager /><span>02 — THE IMPOSSIBLE</span></div>
        <span className="orbit-star star-one">✳</span><span className="orbit-star star-two">✧</span>
        <span className="orbit-note">A thousand places.<br /><em>One first page.</em></span>
      </div>
      <Storybook />
      {!reduced && <LandingEarth progress={progress} running={active && !paused} />}
      <div className="cinema-world-copy"><span className="cinema-eyebrow">EVERY STORY COMES FROM SOMEWHERE</span><h2>A whole world.<br /><em>Between the covers.</em></h2><button onClick={enter}>Explore the story atlas <span aria-hidden="true">↗</span></button></div>
      <div className="cinema-bottom"><span className="cinema-chapter">0{chapter + 1} <i>/</i> {['THE FIRST PAGE', 'UNBOUND', 'A WORLD OF STORIES'][chapter]}</span><button className="cinema-scroll-cue" onClick={() => {
        if (reduced || chapter === 2) { enter(); return; }
        const section = root.current!;
        window.scrollTo({ top: section.getBoundingClientRect().top + window.scrollY + (section.offsetHeight - window.innerHeight) * (chapter === 0 ? .46 : .76), behavior: "smooth" });
      }}><span>{reduced ? 'Enter the atlas' : chapter === 2 ? 'Enter the atlas' : 'Scroll to turn the world'}</span><span aria-hidden="true">↓</span></button><div className="cinema-controls"><button onClick={enter}>Skip to atlas ↗</button>{!reduced && <button onClick={() => setPaused(!paused)} aria-pressed={paused} aria-label={paused ? "Resume animation" : "Pause animation"}>{paused ? '▶' : 'Ⅱ'}</button>}</div></div>
    </div>
  </section>;
}
