import { lazy, Suspense, useEffect, useRef, useState, type RefObject } from "react";
import { ArtCredits } from "../art";
import { StudioSteps, Wordmark } from "../brand";
import { REPOSITORY, STATIC_SITE } from "../site";
import { useStudio } from "../store";
import CinematicIntro, { type IntroActions } from "../cinematic/CinematicIntro";
import { TRADITIONS } from "../cinematic/Astrolabe";
import "../night.css";
import "../landing.css";

const Atlas = lazy(() => import("./Atlas"));

/** Load the globe, its geometry and the story list only when the reader is close to it. */
function useNearby(target: RefObject<HTMLElement | null>, immediate: boolean) {
  const [near, setNear] = useState(immediate);
  useEffect(() => {
    if (near) return;
    if (immediate) { setNear(true); return; }
    const element = target.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setNear(true); }, { rootMargin: "140% 0px" });
    observer.observe(element);
    // Warm it up once the page is idle, so a fast scroll never lands on an empty section.
    const idle = window.requestIdleCallback?.(() => setNear(true), { timeout: 9000 }) ?? window.setTimeout(() => setNear(true), 6000);
    return () => { observer.disconnect(); window.cancelIdleCallback?.(idle); window.clearTimeout(idle); };
  }, [immediate, near, target]);
  return near;
}

export default function Landing({ focusAtlas, active = true }: { focusAtlas: boolean; active?: boolean }) {
  const { go } = useStudio();
  const atlas = useRef<HTMLElement>(null);
  const intro = useRef<IntroActions>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const showAtlas = useNearby(atlas, focusAtlas || reduceMotion || matchMedia("(prefers-reduced-motion: reduce)").matches);
  return <div className="landing-shell cinematic-landing">
    <a className="skip-link" href="#landing-main" onClick={(event) => { event.preventDefault(); document.getElementById("landing-main")?.focus(); }}>Skip to content</a>
    <header className="landing-header pm-bar">
      <Wordmark />
      <nav aria-label="Landing navigation">
        <a href="#/atlas">Story atlas</a>
        {!STATIC_SITE && <><a href="#/projects">Your stories</a><a href="/studio/teams.html">Sign in</a></>}
        {STATIC_SITE && <a href={REPOSITORY} target="_blank" rel="noreferrer">Source</a>}
        {STATIC_SITE
          ? <a className="pm-plate ghost" href="#/overview">Run the studio <span aria-hidden="true">→</span></a>
          : <button className="pm-plate ghost" onClick={() => go("overview")}>Open studio <span aria-hidden="true">→</span></button>}
      </nav>
    </header>
    <main id="landing-main" className="landing-main" tabIndex={-1}>
      <CinematicIntro atlasRef={atlas} actionsRef={intro} active={active} focusAtlas={focusAtlas} reduceMotion={reduceMotion} />
      <section ref={atlas} tabIndex={-1} className="landing-atlas-section cinematic-atlas" aria-label="Explore the story atlas">
        <div className="atlas-ribbon" aria-hidden="true"><div>{[0, 1].map((copy) => <span key={copy}>{TRADITIONS.map((t) => <b key={t}>{t}<i>✦</i></b>)}</span>)}</div></div>
        <div className="cinema-preferences"><button onClick={() => intro.current?.replay()}>Replay the opening</button><button aria-pressed={reduceMotion} onClick={() => setReduceMotion(!reduceMotion)}>Reduce motion</button></div>
        {showAtlas
          ? <Suspense fallback={<AtlasPlaceholder />}><Atlas landing /></Suspense>
          : <AtlasPlaceholder />}
      </section>
    </main>
    <footer className="landing-footer">
      <div className="colophon-lead">
        <p className="pm-kicker"><span>Colophon</span></p>
        <p className="colophon-line">Every story begins <em>somewhere.</em> Yours starts in the studio.</p>
      </div>
      <div className="colophon-grid">
        <section className="colophon-studio" aria-label="The studio">
          <h2>{STATIC_SITE ? "Run the studio" : "Your studio"}</h2>
          {STATIC_SITE
            ? <><p>Projects, drafts and runs stay on your own machine.</p><StudioSteps /></>
            : <><p>Your stories, images and sound live together in your studio.</p><a className="pm-plate" href="#/overview">Continue to your studio <span aria-hidden="true">→</span></a></>}
        </section>
        <section className="colophon-notes" aria-label="About this site">
          <h2>Sources</h2>
          <p>Story records come from the HackTX Literary Mechanisms Corpus: model-written analysis drafts, pinned to where each tale is set or was told. Map data from Natural Earth; relief shading © Esri.</p>
          <ArtCredits />
          <a className="colophon-repo" href={REPOSITORY} target="_blank" rel="noreferrer">ParaMyth on GitHub <span aria-hidden="true">↗</span></a>
        </section>
      </div>
      <div className="colophon-base"><Wordmark /><small>A place to find your next beginning.</small></div>
      <div className="colophon-fine">
        <nav aria-label="Footer">
          <a href="#/atlas">Story atlas</a>
          {STATIC_SITE
            ? <a href="#/overview">Run the studio</a>
            : <><a href="#/overview">Studio</a><a href="#/projects">Your stories</a><a href="/studio/teams.html">Sign in</a></>}
          <a href={REPOSITORY} target="_blank" rel="noreferrer">Source</a>
          <a href={`${REPOSITORY}/issues`} target="_blank" rel="noreferrer">Report an issue</a>
        </nav>
        <p>No analytics or tracking scripts. Fonts load from Google Fonts and map relief from Esri.</p>
        <p>© 2026 Tanish Chauhan · <a href={`${REPOSITORY}/blob/main/LICENSE`} target="_blank" rel="noreferrer">MIT License</a></p>
      </div>
    </footer>
  </div>;
}

function AtlasPlaceholder() {
  return <div className="atlas-loading" role="status"><span className="atlas-loading-orb" aria-hidden="true" />Charting a world of stories</div>;
}
