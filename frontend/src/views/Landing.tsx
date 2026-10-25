import { lazy, Suspense, useRef, useState } from "react";
import { ArtCredits } from "../art";
import { useStudio } from "../store";
import { Icon } from "../ui";
import CinematicIntro, { type IntroActions } from "../cinematic/CinematicIntro";

const Atlas = lazy(() => import("./Atlas"));

export default function Landing({ focusAtlas, active = true }: { focusAtlas: boolean; active?: boolean }) {
  const { go } = useStudio();
  const atlas = useRef<HTMLElement>(null);
  const intro = useRef<IntroActions>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  return <div className="landing-shell cinematic-landing">
    <a className="skip-link" href="#landing-main" onClick={(event) => { event.preventDefault(); document.getElementById("landing-main")?.focus(); }}>Skip to content</a>
    <header className="landing-header">
      <a className="landing-brand" href="#/" aria-label="ParaMyth home"><img className="brand-logo" src="/brand/paramyth-logo.png" width="1280" height="720" alt="ParaMyth" /><span className="brand-tagline">A little wonder.<br />A world of possibility.</span></a>
      <nav aria-label="Landing navigation"><a href="#/atlas">Story atlas</a><a href="#/projects">Your stories</a><a href="/studio/teams.html">Sign in / Join</a><button className="primary" onClick={() => go("overview")}>Open studio <Icon name="arrow" size={15} /></button></nav>
    </header>
    <main id="landing-main" className="landing-main" tabIndex={-1}>
      <CinematicIntro atlasRef={atlas} actionsRef={intro} active={active} focusAtlas={focusAtlas} reduceMotion={reduceMotion} />
      <section ref={atlas} tabIndex={-1} className="landing-atlas-section cinematic-atlas" aria-label="Explore the story atlas">
        <div className="cinema-preferences"><button onClick={() => intro.current?.replay()}>Revisit the introduction</button><button aria-pressed={reduceMotion} onClick={() => setReduceMotion(!reduceMotion)}>Reduce motion</button></div>
        <Suspense fallback={<div className="atlas-loading" role="status">Charting a world of stories…</div>}><Atlas landing /></Suspense>
      </section>
    </main>
    <footer className="landing-footer"><div><a className="footer-brand" href="#/">ParaMyth</a><p>A place to find your next beginning.</p><small>Your stories, images and sound live together in your studio.</small></div><ArtCredits /><a className="footer-studio" href="#/overview">Continue to your studio <Icon name="arrow" size={16} /></a></footer>
  </div>;
}
