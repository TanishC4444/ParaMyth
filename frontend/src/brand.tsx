import { REPOSITORY } from "./site"

/** Compass-rose emblem, drawn as strokes so it stays crisp and costs no download. */
export function Emblem({ className = "" }: { className?: string }) {
  return <svg className={`pm-emblem ${className}`} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <circle cx="32" cy="32" r="29" />
    <circle cx="32" cy="32" r="22.5" strokeDasharray="1.2 3.2" />
    <path d="M32 3v58M3 32h58" opacity=".45" />
    <path className="pm-emblem-star" d="M32 9.5 36.4 27.6 54.5 32 36.4 36.4 32 54.5 27.6 36.4 9.5 32 27.6 27.6Z" />
    <path d="m32 18 2.2 11.8L46 32l-11.8 2.2L32 46l-2.2-11.8L18 32l11.8-2.2Z" opacity=".6" />
    <circle cx="32" cy="32" r="2.6" />
  </svg>
}

export function BrandLogo({ className = "" }: { className?: string }) {
  return <img className={`studio-logo ${className}`} src="/brand/studio-symbol.png" width="1280" height="720" alt="ParaMyth" />
}

export function Wordmark({ href = "#/" }: { href?: string }) {
  return <a className="pm-wordmark" href={href} aria-label="ParaMyth home">
    <Emblem />
    <span className="pm-wordmark-name">Para<em>Myth</em></span>
  </a>
}

export const STUDIO_STEPS: [string, string][] = [
  ["Get the code", `git clone ${REPOSITORY}.git && cd ParaMyth`],
  ["Install the studio", "python -m pip install -e '.[studio,rag,production]'"],
  ["Build this interface", "cd frontend && pnpm install && pnpm build && cd .."],
  ["Open it", "paramyth-studio   # then visit http://127.0.0.1:8770"],
]

/** Copyable setup steps for the local studio. */
export function StudioSteps() {
  return <ol className="pm-steps">
    {STUDIO_STEPS.map(([label, command], i) => <li key={label}>
      <span className="pm-step-index">{String(i + 1).padStart(2, "0")}</span>
      <div>
        <b>{label}</b>
        <code>{command}</code>
      </div>
      <button type="button" className="pm-copy" onClick={(event) => {
        const button = event.currentTarget
        void navigator.clipboard?.writeText(command.split("   #")[0]).then(() => {
          button.dataset.copied = "1"
          setTimeout(() => delete button.dataset.copied, 1600)
        }).catch(() => {})
      }}><span>Copy</span><span>Copied</span></button>
    </li>)}
  </ol>
}
