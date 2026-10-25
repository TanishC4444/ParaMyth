import { artUrl, type Art } from "../art"
import { Emblem } from "../brand"

type World = { art: Art; title: string; chapter: string; tales: string; place: string }
const worlds: World[] = [
  { art: "enchanted", title: "Beyond the familiar", chapter: "I", tales: "Briar Rose sleeps at Sababurg. Beowulf waits at Heorot.", place: "Germanic Europe · Nordic & Baltic" },
  { art: "moonlight", title: "Where the quiet holds a secret", chapter: "II", tales: "Fitcher's Bird. Bluebeard. One door that must stay shut.", place: "Southern & Western Europe" },
  { art: "castle", title: "A kingdom waiting to be found", chapter: "III", tales: "Camelot at Winchester. The long road west from Chang'an.", place: "British Isles · East Asia" },
  { art: "ruins", title: "And a world still to be written", chapter: "IV", tales: "", place: "" },
]

/** Smaller copies made for the book, so the opening never waits on full-size scans. */
const bookArt = (name: Art) => artUrl(name).replace("/art/", "/art/book/")

function Plate({ world }: { world: World }) {
  return <div className="book-face book-recto">
    <div className="book-illustration"><img className="art-image" src={bookArt(world.art)} alt="" decoding="async" /><div className="book-image-light" /></div>
    <div className="book-page-caption"><small>{world.chapter}</small><span>{world.title}</span></div>
    <div className="book-page-shade" />
  </div>
}

function Verso({ world }: { world: World }) {
  return <div className="book-face book-verso book-text">
    <span className="book-folio">{world.chapter}</span>
    <p className="book-dropcap">{world.title}</p>
    <span className="book-rule" />
    <p className="book-tales">{world.tales}</p>
    <small className="book-place">{world.place}</small>
    <div className="book-page-shade" />
  </div>
}

/** Real hinged leaves: a frontispiece, then an illustrated plate facing each typeset page. */
export default function Storybook() {
  return <div className="storybook-exit" aria-hidden="true">
    <div className="storybook-perspective">
      <div className="book-ground-shadow" />
      <div className="storybook-assembly">
        <div className="book-left-block"><div className="book-face book-blank" /></div>
        <div className="book-right-block"><Plate world={worlds[3]} /></div>
        <div className="book-spine" />
        {worlds.slice(0, 3).map((world, index) => <div className={`book-leaf book-leaf-${index}`} key={world.art}>
          <Plate world={world} /><Verso world={world} />
        </div>)}
        <div className="book-cover">
          <div className="book-cover-front"><div className="book-cover-inlay">
            <span className="book-edition">A COLLECTION OF POSSIBILITIES</span>
            <Emblem className="book-emblem" />
            <strong>Para<em>Myth</em></strong><i className="book-motto">Every story begins somewhere.</i><span className="book-cover-rule" /><small>385 TALES · 11 TRADITIONS</small>
          </div></div>
          <div className="book-cover-back book-face book-verso book-text book-frontis">
            <small className="book-exlibris">EX LIBRIS</small>
            <Emblem className="book-frontis-emblem" />
            <p className="book-dropcap">Old stories, <em>new</em> possibilities.</p>
            <span className="book-rule" />
            <small className="book-place">Turn the page</small>
          </div>
        </div>
      </div>
    </div>
  </div>
}
