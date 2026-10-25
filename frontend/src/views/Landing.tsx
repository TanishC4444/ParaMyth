import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ArtCredits, Artwork } from "../art";
import { useStudio } from "../store";
import { Icon } from "../ui";

const Atlas = lazy(() => import("./Atlas"));

export default function Landing({ focusAtlas }: { focusAtlas: boolean }) {
  const { go } = useStudio();
  const atlas = useRef<HTMLElement>(null);
  const [paused, setPaused] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (!focusAtlas) return;
    const frame = requestAnimationFrame(() => atlas.current?.scrollIntoView({ block: "start", behavior: "instant" }));
    return () => cancelAnimationFrame(frame);
  }, [focusAtlas]);
  return <div className={`landing-shell${paused ? " motion-paused" : ""}`}>
    <a className="skip-link" href="#landing-main" onClick={(event) => { event.preventDefault(); document.getElementById("landing-main")?.focus(); }}>Skip to content</a>
    <header className="landing-header">
      <a className="landing-brand" href="#/" aria-label="ParaMyth home"><img className="brand-logo" src="/brand/paramyth-logo.png" width="1280" height="720" alt="ParaMyth" /><span className="brand-tagline">A little wonder.<br />A world of possibility.</span></a>
      <nav aria-label="Landing navigation"><a href="#/atlas">Story atlas</a><a href="#/projects">Your stories</a><a href="/studio/teams.html">Sign in / Join</a><button className="primary" onClick={() => go("overview")}>Open studio <Icon name="arrow" size={15} /></button></nav>
    </header>
    <main id="landing-main" className="landing-main" tabIndex={-1}>
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-copy"><span className="eyebrow">FOR THE WORLDS YOU HAVEN’T WRITTEN YET</span><h1 id="landing-title">Every story begins<br /><em>somewhere.</em></h1><p>Follow a myth across an ocean. Find a character in an old tale. Turn a spark of wonder into a world of your own.</p>
          <div className="hero-actions"><button className="primary" onClick={() => go("atlas")}>Explore the story atlas <Icon name="arrow" size={16} /></button><button className="text-action" onClick={() => go("creative")}>Start with an idea <Icon name="plus" size={15} /></button></div>
          <div className="hero-footnote"><span className="hero-rule" />Discover. Imagine. Make it yours.</div>
        </div>
        <div className="hero-composition">
          <div className="hero-halo" />
          <Artwork name="britomart" decorative={false} eager className="hero-painting" />
          <div className="hero-art-note"><span>THE ART OF POSSIBILITY</span><p>Old stories.<br /><em>New horizons.</em></p><small>Britomart · Walter Crane</small></div>
          <button className="motion-toggle" onClick={() => setPaused(!paused)} aria-pressed={paused}>{paused ? "Resume motion" : "Pause motion"}</button>
        </div>
      </section>
      <section ref={atlas} className="landing-atlas-section" aria-label="Explore the story atlas">
        <Suspense fallback={<div className="atlas-loading" role="status">Charting a world of stories…</div>}><Atlas landing /></Suspense>
      </section>
    </main>
    <footer className="landing-footer"><div><a className="footer-brand" href="#/">ParaMyth</a><p>A place to find your next beginning.</p><small>Your stories, images and sound live together in your studio.</small></div><ArtCredits /><a className="footer-studio" href="#/overview">Continue to your studio <Icon name="arrow" size={16} /></a></footer>
  </div>;
}
