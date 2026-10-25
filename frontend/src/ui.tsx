import type { ReactNode } from "react";
import { requestMessage } from './request-errors';

const paths: Record<string, ReactNode> = {
  chevron: <path d="m8 10 4 4 4-4" />,
  overview: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
  projects: <><path d="M3 7h6l2 2h10v10H3z" /><path d="M3 11h18" /></>,
  ideas: <><path d="M9 18h6M10 22h4" /><path d="M8 15a7 7 0 1 1 8 0c-1.3 1-2 2-2 3h-4c0-1-.7-2-2-3Z" /></>,
  runs: <><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="12" r="2.5" /><path d="M6 8.5v7M8.3 7.2l7.4 3.6M8.3 16.8l7.4-3.6" /></>,
  canon: <><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h11" /></>,
  retrieval: <><path d="M4 4h4v16H4zM10 4h4v16h-4z" /><path d="m16 5 4 1-3 14-4-1z" /></>,
  images: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></>,
  music: <><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>,
  production: <><rect x="3" y="9" width="18" height="11" rx="1.5" /><path d="m3 9 3-5 4 5M10 4l4 5M14 4l4 5" /></>,
  news: <><path d="M5 4h12v16H7a2 2 0 0 1-2-2z" /><path d="M17 8h2v10a2 2 0 0 1-2 2" /><path d="M8 8h6M8 12h6M8 16h4" /></>,
  library: <><path d="M4 4h6l2 3h8v13H4z" /><path d="M9 13h6M9 16h4" /></>,
  connections: <><path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0z" /><path d="M12 16v5" /></>,
  atlas: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9M12 3c-2.5 2.6-3.8 5.6-3.8 9s1.3 6.4 3.8 9" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  message: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  grid: <><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><rect x="14" y="14" width="6" height="6" /></>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5" /><path d="M5 21h14" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m5 12 4 4 10-10" />,
  alert: <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  play: <path d="m7 4 13 8-13 8z" />,
  pin: <><path d="M9 3h6l-1 6 4 4H6l4-4z" /><path d="M12 13v8" /></>,
  pen: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
  sparkle: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="m9 3-.5 2.3-2 .9-2.1-.7-2 3.5 1.7 1.6v2.8L2.4 15l2 3.5 2.1-.7 2 .9L9 21h6l.5-2.3 2-.9 2.1.7 2-3.5-1.7-1.6v-2.8L21.6 9l-2-3.5-2.1.7-2-.9L15 3Z" /></>,
};

export const Icon = ({ name, size = 19 }: { name: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
);

export const Status = ({ children }: { children: string }) => <span className={`status ${children.toLowerCase().replace(/\s+/g, "-")}`}><i />{children}</span>;

export const PageTitle = ({ eyebrow, title, text, children, level = "h1" }: { eyebrow?: string; title: string; text: string; children?: ReactNode; level?: "h1" | "h2" }) => (
  <div className="page-title"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}{level === "h1" ? <h1>{title}</h1> : <h2>{title}</h2>}{text && <p>{text}</p>}</div>{children && <div className="title-actions">{children}</div>}</div>
);

export const Chips = ({ items, onChange, placeholder }: { items: string[]; onChange: (v: string[]) => void; placeholder: string }) => (
  <div className="chips">
    {items.map((t, i) => <span key={t + i}>{t}<button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>×</button></span>)}
    <input aria-label={placeholder} placeholder={placeholder} onKeyDown={(e) => { const v = e.currentTarget.value.trim(); if (e.key === "Enter" && v) { e.preventDefault(); onChange([...items, v]); e.currentTarget.value = ""; } }} />
  </div>
);

export const Segmented = <T extends string>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string }) => (
  <div className="segmented" role="radiogroup" aria-label={label}>
    {options.map((o,index) => <button type="button" role="radio" aria-checked={o === value} tabIndex={o === value || !options.includes(value)&&index===0 ? 0 : -1} key={o} className={o === value ? "selected" : ""} onClick={() => onChange(o)} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+options.length)%options.length;onChange(options[next]);(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next])?.focus()}}>{o}</button>)}
  </div>
);

/** Message text for people: drops the "Error:" prefix that String(error) adds. */
export const errorText = (e: unknown) => requestMessage(e instanceof Error ? e.message : String(e), (e as any)?.status);

export const fmtDate = (iso: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(iso));
export const fmtTime = (iso: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
export const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};

export function EmptyState({ icon, title, text, action }: { icon: string; title: string; text: string; action?: ReactNode }) {
  return <div className="studio-empty"><span className="empty-icon"><Icon name={icon} size={25} /></span><h2>{title}</h2><p>{text}</p>{action && <div className="empty-actions">{action}</div>}</div>
}
