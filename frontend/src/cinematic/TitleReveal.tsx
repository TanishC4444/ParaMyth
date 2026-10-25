export default function TitleReveal() {
  return <div className="cinema-title-reveal">
    <p className="cinema-title-kicker">Old stories · New possibilities</p>
    <h1 aria-label="ParaMyth">{"ParaMyth".split("").map((letter, i) => <span className={`cinema-letter${i > 3 ? " myth" : ""}`} aria-hidden="true" key={i}>{letter}</span>)}</h1>
    <svg className="cinema-flourish" viewBox="0 0 600 40" fill="none" aria-hidden="true">
      <path pathLength={1} d="M8 22c70 0 110-14 180-14 62 0 78 22 112 22s50-22 112-22c70 0 110 14 180 14" />
      <path pathLength={1} d="m300 8 5 12 12 5-12 5-5 12-5-12-12-5 12-5Z" className="flourish-star" />
    </svg>
    <p className="cinema-title-line">Find your next beginning.</p>
  </div>
}
