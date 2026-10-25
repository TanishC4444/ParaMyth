import { Artwork, type Art } from "../art";

const worlds: { art: Art; title: string; chapter: string }[] = [
  { art: "enchanted", title: "Beyond the familiar", chapter: "I" },
  { art: "moonlight", title: "Where the quiet holds a secret", chapter: "II" },
  { art: "castle", title: "A kingdom waiting to be found", chapter: "III" },
  { art: "ruins", title: "And a world still to be written", chapter: "IV" },
];

function Illustration({ world, back = false }: { world: typeof worlds[number]; back?: boolean }) {
  return <div className={`book-face ${back ? "book-verso" : "book-recto"}`}>
    <div className="book-illustration"><Artwork name={world.art} eager /><div className="book-image-light" /></div>
    <div className="book-page-shade" />
  </div>;
}

/** Real hinged leaves, with separate front/back faces and a fixed paper block. */
export default function Storybook() {
  return <div className="storybook-exit" aria-hidden="true">
    <div className="storybook-perspective">
      <div className="book-ground-shadow" />
      <div className="storybook-assembly">
        <div className="book-bottom-cover" />
        <div className="book-page-block">{Array.from({ length: 15 }, (_, i) => <div className="book-page-stack" key={i} style={{ transform: `translateZ(${-i * 1.5}px)` }} />)}<Illustration world={worlds[3]} /><div className="book-edge edge-fore" /><div className="book-edge edge-top" /><div className="book-edge edge-bottom" /></div>

        <div className="book-spine" />
        {worlds.slice(0, 3).map((world, index) => <div className={`book-leaf book-leaf-${index}`} key={world.art}>
          <Illustration world={world} /><Illustration world={world} back />
        </div>)}
        <div className="book-cover">
          <div className="book-cover-front"><div className="book-cover-inlay">
            <svg className="book-emblem" viewBox="0 0 120 120" fill="none"><circle cx="60" cy="60" r="46" /><circle cx="60" cy="60" r="36" /><path d="M60 5v110M5 60h110M21 21l78 78M21 99l78-78" /><path d="m60 22 9 29 29 9-29 9-9 29-9-29-29-9 29-9Z" /><circle cx="60" cy="60" r="7" /></svg>
            <strong>PM</strong>
          </div></div>
          <div className="book-cover-back"><Illustration world={worlds[0]} /></div>
          <div className="cover-edge cover-fore" /><div className="cover-edge cover-top" /><div className="cover-edge cover-bottom" />
        </div>
      </div>
    </div>
  </div>;
}
