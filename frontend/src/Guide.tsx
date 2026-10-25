import { useId, useRef, useState, type ReactNode } from "react"

/** A tap- and keyboard-operated explanation, rather than a hover-only tooltip. */
export function HelpTip({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false),
    id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }
  return (
    <span
      className="help-tip"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          close()
          event.stopPropagation()
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="help-tip-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">i</span>
      </button>
      {open && (
        <span id={id} className="help-tip-copy" role="note">
          {children}
          <button type="button" className="text-action" onClick={close}>
            Close explanation
          </button>
        </span>
      )}
    </span>
  )
}

export function WorkspaceGuide() {
  return (
    <details className="workspace-guide">
      <summary>New here? Start with your idea</summary>
      <p>
        Describe what you want to make, then choose Start writing. Suggestions
        are optional and only change your idea when you accept them. Your
        chapters, research, visuals and sound stay in this project.
      </p>
      <a href="#/tutorials">Open tutorials</a>
    </details>
  )
}
