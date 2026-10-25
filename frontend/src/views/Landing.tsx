import { lazy, Suspense, useCallback, useRef, useState } from "react";
import { Artwork } from "../art";
import { useStudio } from "../store";
import { Icon } from "../ui";
import { useAccess } from "../AccountGate";
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
  const syncWorld = useCallback(() => intro.current?.syncWorld(), []);
  const [bookVisible, setBookVisible] = useState(!focusAtlas);
  const onBookChange = useCallback((visible: boolean) => setBookVisible(visible), []);
  const [reduceMotion, setReduceMotion] = useState(false);

  return <div className="landing-shell cinematic-landing">
    <a className="skip-link" href="#landing-main" onClick={(event) => { event.preventDefault(); intro.current?.enter(); }}>Skip to content</a>
    <header className="landing-header">
      <nav aria-label="Landing navigation">
        <button className="dock-atlas" onClick={() => bookVisible ? intro.current?.enter() : intro.current?.replay()}><Icon name={bookVisible ? "atlas" : "library"} size={16} /><span>{bookVisible ? "Story Atlas" : "The Book"}</span></button>
        {!access.authenticated && <><a className="dock-account" href="#/signin">Sign in</a><a className="dock-create" href="#/signup">Create account</a></>}
        <button className="dock-studio" onClick={() => go("overview")}>Open Studio <Icon name="arrow" size={14} /></button>
      </nav>
    </header>
    <main id="landing-main" className="landing-main" tabIndex={-1}>
      <CinematicIntro atlasRef={atlas} actionsRef={intro} active={active} focusAtlas={focusAtlas} reduceMotion={reduceMotion} onBookChange={onBookChange} onPrepareAtlas={prepareAtlas} />
      <section ref={atlas} tabIndex={-1} className="landing-atlas-section cinematic-atlas" aria-label="Explore the story atlas">
        {atlasPrepared && <Suspense fallback={<PageLoading label="Loading the Story Atlas…" />}><Atlas landing reduceMotion={reduceMotion} onReady={syncWorld} /></Suspense>}

      </section>
    </main>
    <section className="product-purpose" aria-labelledby="purpose-title">
      <div><h2 id="purpose-title">Story Development<br /><em>for Creative Directors</em></h2><p>ParaMyth helps creative directors brainstorm story concepts, draft treatments, and explore production ideas. Start with a classic story, reshape its characters and world, and develop a rough direction before committing to production.</p><button onClick={() => go("overview")}>Explore the Studio <span aria-hidden="true">↗</span></button></div>
      <ol><li><h3>Find a Starting Point</h3><p>Explore myths, fairy tales, and epics through the Story Atlas.</p></li><li><h3>Shape the Story</h3><p>Develop a premise, characters, tone, and an early draft.</p></li><li><h3>Explore the Production</h3><p>Work through visual direction, scene ideas, and a rough production plan.</p></li></ol>
    </section>
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
      <small className="footer-note">© {new Date().getFullYear()} ParaMyth. Original artwork and source texts retain their respective rights.</small>
    </footer>
  </div>;
}
