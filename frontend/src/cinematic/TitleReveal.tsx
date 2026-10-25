export default function TitleReveal() {
  return <div className="cinema-title-reveal">
    <p className="cinema-title-kicker">OLD STORIES. NEW POSSIBILITIES.</p>
    <h1 aria-label="ParaMyth">{"ParaMyth".split("").map((letter, i) => <span className="cinema-letter" aria-hidden="true" key={i}>{letter}</span>)}</h1>
    <p className="cinema-title-line">Find your next beginning.</p>
  </div>;
}
