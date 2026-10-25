import type { CSSProperties } from "react";
import credits from "./art-credits.json";
import type { Project } from "./types";

export type Art = "krishna" | "dragon" | "phoenix" | "britomart" | "castle" | "ruins" | "forest" | "forest-path" | "enchanted" | "palace" | "sleeping-beauty" | "moonlight" | "music" | "nebula" | "paper";
export const artUrl = (name: Art) => `${import.meta.env.BASE_URL}art/${name}.webp`;
const positions: Partial<Record<Art, string>> = { krishna: "50% 60%", dragon: "50% 65%", phoenix: "50% 50%", britomart: "67% 45%", castle: "62% 55%", ruins: "60% 45%", moonlight: "50% 68%", palace: "50% 32%", music: "60% 60%" };

export function Artwork({ name, className = "", decorative = true, eager = false, style }: { name: Art; className?: string; decorative?: boolean; eager?: boolean; style?: CSSProperties }) {
  const credit = credits.find((c) => c.file === `${name}.webp`)!;
  return <img className={`art-image ${className}`} src={artUrl(name)} alt={decorative ? "" : credit.title} width={credit.width} height={credit.height} loading={eager ? "eager" : "lazy"} decoding="async" fetchPriority={eager ? "high" : "auto"} style={{ objectPosition: positions[name], ...style }} />;
}

/** Covers illustrate the premise's setting or genre, not generated project output. */
export function projectArt(project: Project): Art {
  const text = `${project.title} ${project.brief.genre} ${project.brief.premise}`.toLowerCase();
  if (/troy|ancient|bronze|greek|roman|ruin/.test(text)) return "ruins";
  if (/space|cosmic|galaxy|planet|orbit/.test(text)) return "nebula";
  if (/greenhouse|forest|garden|botan|woodland/.test(text)) return "forest";
  if (/night|lantern|noir|mystery|moon/.test(text)) return "moonlight";
  if (/fairy|magic|enchanted/.test(text)) return "enchanted";
  if (/knight|quest|hero/.test(text)) return "britomart";
  return "castle";
}

export function storyArt(title: string): Art | null {
  if (/krishna|gita govinda|bhagavata|rasa lila/i.test(title)) return "krishna";
  if (/shahnameh|shahnama|bahram|rustam|rostam/i.test(title)) return "dragon";
  if (/phoenix/i.test(title)) return "phoenix";
  if (/sleeping beauty|briar rose/i.test(title)) return "sleeping-beauty";
  if (/faerie queene|britomart/i.test(title)) return "britomart";
  if (/aeneid|iliad|agamemnon|antigone|odyssey|aeschylus|ovid/i.test(title)) return "ruins";
  if (/hansel|red riding|snow white|rapunzel|grimm/i.test(title)) return "enchanted";
  if (/nightingale|hans andersen/i.test(title)) return "palace";
  if (/arthur|lancelot|gawain|camelot/i.test(title)) return "castle";
  return null;
}

export function StoryArtwork({ title }: { title: string }) {
  const art = storyArt(title);
  if (!art) return null;
  const credit = credits.find((c) => c.file === `${art}.webp`)!;
  return <figure className="story-art"><Artwork name={art} decorative={false} /><figcaption>Visual inspiration · <a href={credit.source_page_url} target="_blank" rel="noreferrer">{credit.title}</a></figcaption></figure>;
}

export function ArtCredits() {
  return <details className="art-credits"><summary>Art & Sources</summary><p>Public-domain and CC0 artworks.</p><ul>{credits.filter((c) => c.file !== "paper.webp").map((c) => <li key={c.file}><a href={c.source_page_url} target="_blank" rel="noreferrer">{c.title}</a> · {c.creator || "Unknown artist"} · {c.license}</li>)}</ul><a href={`${import.meta.env.BASE_URL}art/manifest.json`}>Complete source and license record</a></details>;
}
