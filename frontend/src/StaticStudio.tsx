import { StudioSteps, Wordmark } from "./brand"
import { REPOSITORY } from "./site"
import "./night.css"

const FEATURES: [string, string][] = [
  ["Projects", "Briefs, manuscripts, canon and run history, kept together per story."],
  ["Writing pipelines", "Plan, draft, review and repair scenes with checks you can read."],
  ["Images and sound", "Concept art, soundtracks and production plans beside the text."],
]

/** What the static site shows in place of the studio, which needs a local server. */
export default function StaticStudio() {
  return <div className="night-page static-studio">
    <header className="pm-bar">
      <Wordmark />
      <nav aria-label="Site"><a href="#/atlas">Story atlas</a><a href={REPOSITORY} target="_blank" rel="noreferrer">Source</a></nav>
    </header>
    <main className="static-studio-main" id="studio-setup" tabIndex={-1}>
      <p className="pm-kicker"><span>The studio</span></p>
      <h1>The studio runs on <em>your</em> machine.</h1>
      <p className="static-studio-lede">This site holds the story atlas. Projects, drafts, model runs and files stay local, so the studio needs its own small server. Setup takes four commands.</p>
      <StudioSteps />
      <ul className="static-studio-features">
        {FEATURES.map(([title, text], i) => <li key={title}><span>{["I", "II", "III"][i]}</span><b>{title}</b><p>{text}</p></li>)}
      </ul>
      <a className="pm-plate" href="#/atlas">Back to the atlas <span aria-hidden="true">→</span></a>
    </main>
  </div>
}
