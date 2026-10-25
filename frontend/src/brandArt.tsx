import type { Project } from "./types";

/** Flat storybook illustrations in the ParaMyth logo's palette: swirling clouds, a guiding star, an open book. */
const C = { navy: "#24427f", deep: "#2c5596", blue: "#3b6fae", teal: "#48c9c0", aqua: "#86e6e4", gold: "#f6b829", butter: "#fff08a", amber: "#e9a84a", page: "#fbe3b5", rose: "#e8957a", rust: "#c3654b" };

const star = (cx: number, cy: number, long: number, short: number, inner = short * 0.45) => {
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (Math.PI / 8) * i - Math.PI / 2;
    const r = i % 4 === 0 ? long : i % 2 === 0 ? short : inner;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return pts.join(" ");
};
const twinkle = (cx: number, cy: number, r: number) => `M${cx} ${cy - r}Q${cx} ${cy} ${cx + r} ${cy}Q${cx} ${cy} ${cx} ${cy + r}Q${cx} ${cy} ${cx - r} ${cy}Q${cx} ${cy} ${cx} ${cy - r}Z`;
const swirl = (cx: number, cy: number, r: number, flip = 1) => `M${cx} ${cy}c${3 * flip} -4 ${9 * flip} -2 ${9 * flip} 4c0 ${r * 0.4} ${-r * 0.5 * flip} ${r * 0.55} ${-r * 0.75 * flip} ${r * 0.1}c${-r * 0.35 * flip} ${-r * 0.55} ${r * 0.05 * flip} ${-r * 1.15} ${r * 0.75 * flip} ${-r * 1.05}`;

/** The full scene, used where the studio greets you. */
export function BrandScene({ className = "" }: { className?: string }) {
  return <svg className={`brand-scene ${className}`} viewBox="0 0 400 300" aria-hidden="true">
    <g className="brand-clouds">
      {[[112, 92, 50], [200, 62, 58], [288, 92, 50], [82, 162, 42], [318, 162, 42], [128, 214, 36], [272, 214, 36]].map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill={C.teal} />)}
      {[[150, 122, 56], [250, 122, 56], [200, 156, 70], [122, 186, 42], [278, 186, 42], [200, 96, 46]].map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill={i % 2 ? C.deep : C.blue} opacity=".92" />)}
      {[[200, 160, 54], [160, 196, 34], [240, 196, 34]].map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill={C.navy} />)}
    </g>
    <g className="brand-swirls" fill="none" stroke={C.aqua} strokeWidth="5" strokeLinecap="round">
      <path d={swirl(98, 82, 26)} /><path d={swirl(300, 84, 26, -1)} /><path d={swirl(196, 46, 22)} />
      <path d={swirl(78, 170, 18)} opacity=".8" /><path d={swirl(322, 168, 18, -1)} opacity=".8" />
    </g>
    <g className="brand-rays" fill={C.amber}>
      <path d="M200 262C182 226 160 206 132 196C164 214 182 236 196 264Z" /><path d="M200 262C218 226 240 206 268 196C236 214 218 236 204 264Z" />
      <path d="M200 262C196 232 186 214 170 202C188 222 194 240 197 264Z" opacity=".85" /><path d="M200 262C204 232 214 214 230 202C212 222 206 240 203 264Z" opacity=".85" />
    </g>
    <g className="brand-star">
      <polygon points={star(200, 132, 64, 30)} fill={C.gold} />
      <polygon points={star(200, 132, 34, 16)} fill={C.butter} />
    </g>
    <g className="brand-twinkles" fill={C.gold}>
      {[[132, 120, 8], [270, 112, 9], [150, 76, 6], [252, 72, 7], [118, 196, 7], [284, 192, 8], [176, 210, 5], [228, 214, 6]].map(([x, y, r], i) => <path key={i} d={twinkle(x, y, r)} style={{ animationDelay: `${i * 0.37}s` }} />)}
    </g>
    <g className="brand-book">
      <path d="M52 262Q126 240 200 266Q274 240 348 262L356 280Q276 262 200 290Q124 262 44 280Z" fill={C.navy} />
      <path d="M62 228Q132 208 198 244V272Q132 240 56 260Z" fill={C.page} /><path d="M338 228Q268 208 202 244V272Q268 240 344 260Z" fill={C.page} />
      <path d="M90 236Q140 222 186 246V266Q140 242 84 254Z" fill={C.rose} opacity=".55" /><path d="M310 236Q260 222 214 246V266Q260 242 316 254Z" fill={C.rose} opacity=".55" />
      <g stroke={C.rust} strokeWidth="2.2" strokeLinecap="round" fill="none" opacity=".75">
        <path d="M84 238Q132 228 180 248" /><path d="M80 248Q130 238 178 258" /><path d="M220 248Q268 228 316 238" /><path d="M222 258Q270 238 320 248" />
      </g>
    </g>
  </svg>;
}

/** Small spot art for empty states. */
export function BrandSpot({ kind = "book" }: { kind?: "book" | "music" | "image" | "map" }) {
  return <svg className={`brand-spot spot-${kind}`} viewBox="0 0 160 120" aria-hidden="true">
    <circle cx="58" cy="58" r="34" fill={C.teal} /><circle cx="100" cy="50" r="38" fill={C.blue} /><circle cx="84" cy="74" r="30" fill={C.navy} />
    <path d={swirl(46, 50, 14)} fill="none" stroke={C.aqua} strokeWidth="4" strokeLinecap="round" />
    {kind === "music" && <g fill="none" stroke={C.butter} strokeWidth="5" strokeLinecap="round"><path d="M76 82V46l28-6v34" /><circle cx="70" cy="84" r="7" fill={C.butter} /><circle cx="98" cy="76" r="7" fill={C.butter} /></g>}
    {kind === "image" && <g><rect x="62" y="44" width="48" height="38" rx="5" fill={C.page} /><path d="M66 78l12-14 9 9 7-6 12 11z" fill={C.rose} /><circle cx="98" cy="54" r="5" fill={C.gold} /></g>}
    {kind === "map" && <g fill="none" stroke={C.butter} strokeWidth="4" strokeLinecap="round"><circle cx="86" cy="62" r="20" /><path d="M66 62h40M86 42c7 6 10 13 10 20s-3 14-10 20M86 42c-7 6-10 13-10 20s3 14 10 20" /></g>}
    {kind === "book" && <polygon className="brand-star" points={star(86, 60, 26, 12)} fill={C.gold} />}
    <path className="brand-twinkle-one" d={twinkle(128, 26, 7)} fill={C.gold} /><path className="brand-twinkle-two" d={twinkle(30, 96, 5)} fill={C.gold} />
    <path d="M22 108Q80 96 138 108" stroke={C.navy} strokeWidth="5" strokeLinecap="round" fill="none" />
  </svg>;
}

const PALETTES = [[C.teal, C.blue, C.navy], [C.aqua, C.teal, C.deep], [C.rose, C.amber, C.navy], [C.teal, C.navy, C.blue]];
const seed = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** A cover drawn from the project's id, so each story keeps the same look. */
export function ProjectCover({ project }: { project: Pick<Project, "id" | "title"> }) {
  const h = seed(project.id || project.title || "paramyth");
  const [a, b, c] = PALETTES[h % PALETTES.length];
  const x = 104 + (h % 32), y = 64 + ((h >> 4) % 16);
  return <svg className="project-art" viewBox="0 0 240 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="240" height="150" fill={(h >> 3) % 2 ? "#f5b07a" : "#f8c97a"} />
    <circle cx={x - 34} cy={y + 4} r="30" fill={a} /><circle cx={x + 34} cy={y + 2} r="30" fill={a} /><circle cx={x} cy={y - 22} r="34" fill={a} />
    <circle cx={x - 16} cy={y + 10} r="28" fill={b} /><circle cx={x + 18} cy={y + 8} r="28" fill={b} /><circle cx={x} cy={y + 20} r="26" fill={c} />
    <path d={swirl(x - 44, y - 6, 14)} fill="none" stroke={C.aqua} strokeWidth="3.5" strokeLinecap="round" />
    <path d={swirl(x + 44, y - 8, 14, -1)} fill="none" stroke={C.aqua} strokeWidth="3.5" strokeLinecap="round" />
    <polygon points={star(x, y + 2, 24, 11)} fill={C.gold} /><polygon points={star(x, y + 2, 12, 6)} fill={C.butter} />
    <path d={twinkle(x + 70, y - 34, 6)} fill={C.butter} /><path d={twinkle(x - 72, y + 40, 5)} fill={C.butter} />
  </svg>;
}
