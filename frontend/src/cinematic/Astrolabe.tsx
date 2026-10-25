export const TRADITIONS = [
  "Americas", "British Isles", "East Asia", "Germanic Europe", "Greece & Rome", "Near East & Egypt",
  "Nordic & Baltic", "Persia & Central Asia", "Slavic Europe", "South Asia", "Southern & Western Europe",
]

const ticks = Array.from({ length: 120 }, (_, i) => {
  const angle = (i / 120) * Math.PI * 2, long = i % 10 === 0, inner = long ? 452 : 464
  return `M${500 + Math.cos(angle) * inner} ${500 + Math.sin(angle) * inner}L${500 + Math.cos(angle) * 476} ${500 + Math.sin(angle) * 476}`
}).join("")

/** The eleven traditions engraved on a slowly turning dial behind the book. */
export default function Astrolabe() {
  return <div className="cinema-astrolabe" aria-hidden="true"><div className="dial-tilt">
    <svg viewBox="0 0 1000 1000" fill="none">
      <defs><path id="pm-dial" d="M500 500m-418 0a418 418 0 1 1 836 0a418 418 0 1 1-836 0" /></defs>
      <circle className="dial-line" cx="500" cy="500" r="490" />
      <circle className="dial-line faint" cx="500" cy="500" r="476" />
      <path className="dial-ticks" d={ticks} />
      <circle className="dial-line faint" cx="500" cy="500" r="440" strokeDasharray="2 7" />
      <text className="dial-text"><textPath href="#pm-dial" textLength="2610">{TRADITIONS.map((t) => `${t.toUpperCase()}  ✦  `).join("")}</textPath></text>
      <circle className="dial-line" cx="500" cy="500" r="392" />
      <path className="dial-line faint" d="M500 10v980M10 500h980M153 153l694 694M153 847l694-694" />
    </svg>
  </div></div>
}
