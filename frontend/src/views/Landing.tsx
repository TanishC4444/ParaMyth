import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Artwork } from "../art";
import { useStudio } from "../store";
import { Icon } from "../ui";
import { useAccess } from "../AccountGate";
import "../about.css";
import Instagram from "../Instagram";
import { CONTACT_EMAIL } from "../contact";
import { SiteLinks } from "../SiteLinks";
import { PageLoading } from "../system-pages";
import credits from "../art-credits.json";
import { BOOK_ART, GALLERY_ART } from "../cinematic/scenes";
import CinematicIntro, { type IntroActions } from "../cinematic/CinematicIntro";

const Atlas = lazy(() => import("./Atlas"));

export default function Landing({ focusAtlas, active = true }: { focusAtlas: boolean; active?: boolean }) {
  const { go } = useStudio();
  const access = useAccess();
  const atlas = useRef<HTMLElement>(null);
  const intro = useRef<IntroActions>(null);
  const [atlasPrepared, setAtlasPrepared] = useState(focusAtlas);
  const prepareAtlas = useCallback(() => setAtlasPrepared(true), []);
  useEffect(() => {
    if (atlasPrepared || !active) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { prepareAtlas(); observer.disconnect(); }
    }, { rootMargin: "300px" });
    if (atlas.current) observer.observe(atlas.current);
    return () => observer.disconnect();
  }, [active, atlasPrepared, prepareAtlas]);
  const syncWorld = useCallback(() => intro.current?.syncWorld(), []);
  const [bookVisible, setBookVisible] = useState(!focusAtlas);
  const onBookChange = useCallback((visible: boolean) => setBookVisible(visible), []);
  const [reduceMotion, setReduceMotion] = useState(false);

  return <div className="landing-shell cinematic-landing">
    <a className="skip-link" href="#purpose-title" onClick={(event) => { event.preventDefault(); const about = document.querySelector<HTMLElement>(".about-section"); if (about) { about.inert = false; about.scrollIntoView({ behavior: "instant" }); } document.getElementById("purpose-title")?.focus({ preventScroll: true }); }}>Skip to content</a>
    <header className="landing-header">
      <nav aria-label="Landing navigation">
        <button className="dock-atlas" onClick={() => bookVisible ? intro.current?.enter() : intro.current?.replay()}><Icon name={bookVisible ? "atlas" : "library"} size={16} /><span>{bookVisible ? "Story Atlas" : "The Book"}</span></button>
        <button className="dock-studio" onClick={() => go("overview")}>Open Studio <Icon name="arrow" size={14} /></button>
      </nav>
    </header>
    <main id="landing-main" className="landing-main" tabIndex={-1}>
      <CinematicIntro atlasRef={atlas} actionsRef={intro} active={active} focusAtlas={focusAtlas} reduceMotion={reduceMotion} onBookChange={onBookChange} onPrepareAtlas={prepareAtlas} />
      <section className="about-section" aria-labelledby="purpose-title">
        <div className="about-intro">
          <div><span className="about-eyebrow">About ParaMyth</span><h2 id="purpose-title" tabIndex={-1}>Story Development<br /><em>for Creative Directors</em></h2></div>
          <div className="about-description"><p>Brainstorm concepts, draft treatments, and explore production ideas before committing to a direction. ParaMyth brings classic stories, early writing, and visual planning into one creative workspace.</p><div className="about-actions"><button onClick={() => go("overview")}>Explore the Studio <span aria-hidden="true">↗</span></button>{!access.authenticated && <a href="#/signin">Sign In</a>}</div></div>
        </div>
        <ol className="about-workflow"><li><h3>Discover</h3><p>Find a starting point in myths, fairy tales, and epics.</p></li><li><h3>Develop</h3><p>Shape the premise, characters, tone, and rough draft.</p></li><li><h3>Plan</h3><p>Explore scenes, visual direction, and production ideas.</p></li></ol>
        <Instagram enabled={active && !bookVisible} />
      </section>
      <section ref={atlas} tabIndex={-1} className="landing-atlas-section cinematic-atlas" aria-label="Explore the story atlas">
        {atlasPrepared && <Suspense fallback={<PageLoading label="Loading the Story Atlas…" />}><Atlas landing reduceMotion={reduceMotion} onReady={syncWorld} /></Suspense>}
      </section>
    </main>
    <section className="image-library" aria-label="Artwork collection">
      <div className="library-heading"><h2>Illustrated Classics</h2><span>{GALLERY_ART.length} Artworks</span></div>
      <div className="library-grid">{GALLERY_ART.map(name => {
        const art = credits.find(c => c.file === `${name}.webp`)!;
        const index = BOOK_ART.indexOf(name);
        const content = <><Artwork name={name} variant="book" decorative={false} /><span>{art.title}</span></>;
        return index >= 0 ? <button key={name} onClick={() => intro.current?.scene(Math.floor(index / 2))} aria-label={`View ${art.title} in the Book`}>{content}</button> : <a key={name} href={art.source_page_url} target="_blank" rel="noreferrer" aria-label={`View source for ${art.title}`}>{content}</a>;
      })}</div>
    </section>
    <footer className="landing-footer">
      <a className="footer-brand" href="#/">ParaMyth</a>
      <div className="footer-controls"><button aria-pressed={reduceMotion} onClick={() => setReduceMotion(!reduceMotion)}>Reduce Motion</button></div>
      <SiteLinks />
      <a className="footer-contact" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      <small className="footer-note">© {new Date().getFullYear()} ParaMyth. Original artwork and source texts retain their respective rights.</small>
    </footer>
  </div>;
}
