import { lazy, Suspense, useCallback, useRef, useState } from "react";
import { ArtCredits } from "../art";
import { useStudio } from "../store";
import { Icon } from "../ui";
import CinematicIntro, { type IntroActions } from "../cinematic/CinematicIntro";

const Atlas = lazy(() => import("./Atlas"));

export default function Landing({ focusAtlas, active = true }: { focusAtlas: boolean; active?: boolean }) {
  const { go } = useStudio();
  const atlas = useRef<HTMLElement>(null);
  const intro = useRef<IntroActions>(null);
  const [bookVisible, setBookVisible] = useState(!focusAtlas);
  const onBookChange = useCallback((visible: boolean) => setBookVisible(visible), []);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [worldReady, setWorldReady] = useState(false);
  const revealWorld = useCallback(() => setWorldReady(true), []);
  return <div className="landing-shell cinematic-landing">
    <a className="skip-link" href="#landing-main" onClick={(event) => { event.preventDefault(); intro.current?.enter(); }}>Skip to content</a>
    <header className="landing-header">
      <nav aria-label="Landing navigation">
        <button className="dock-atlas" onClick={() => bookVisible ? intro.current?.enter() : intro.current?.replay()}><Icon name={bookVisible ? "atlas" : "library"} size={16} /><span>{bookVisible ? "Story Atlas" : "The Book"}</span></button>
        <button className="dock-studio" onClick={() => go("overview")}>Open Studio <Icon name="arrow" size={14} /></button>
      </nav>
    </header>
    <main id="landing-main" className="landing-main" tabIndex={-1}>
      <CinematicIntro atlasRef={atlas} actionsRef={intro} active={active} focusAtlas={focusAtlas} reduceMotion={reduceMotion} worldReady={worldReady} onBookChange={onBookChange} />
      <section ref={atlas} tabIndex={-1} className="landing-atlas-section cinematic-atlas" aria-label="Explore the story atlas">
        <Suspense fallback={<div className="atlas-loading" role="status">Charting a world of stories…</div>}><Atlas landing reduceMotion={reduceMotion} onReady={revealWorld} /></Suspense>

      </section>
    </main>
    <footer className="landing-footer">
      <a className="footer-brand" href="#/">ParaMyth</a>
      <div className="footer-controls"><button aria-pressed={reduceMotion} onClick={() => setReduceMotion(!reduceMotion)}>Reduce Motion</button></div>
      <ArtCredits />
    </footer>
  </div>;
}
