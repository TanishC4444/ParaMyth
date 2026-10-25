import { useState } from "react"
import { backendFetch, projectPath } from "./api"
import { useStudio } from "./store"
import { errorText } from "./ui"
import { HelpTip } from "./Guide"

export default function ExportPanel({
  sceneId = "",
  beforeDownload,
}: {
  sceneId?: string
  beforeDownload?: () => Promise<void>
}) {
  const { project, flush, notify } = useStudio()
  const [format, setFormat] = useState("docx"),
    [scope, setScope] = useState("all"),
    [packet, setPacket] = useState("manuscript"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("")
  const download = async () => {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      if (beforeDownload) await beforeDownload()
      await flush()
      const params = new URLSearchParams({
        format,
        packet,
        scene_id: scope === "chapter" ? sceneId : "",
      })
      const response = await backendFetch(
        projectPath("/api/ui/writing/export?" + params, project.id),
        { signal: AbortSignal.timeout(60000) },
      )
      if (!response.ok) {
        const value = await response.json().catch(() => ({}))
        throw Error(
          value.detail || "Your document could not be downloaded. Try again.",
        )
      }
      const blob = await response.blob(),
        url = URL.createObjectURL(blob),
        anchor = document.createElement("a")
      const file = response.headers
        .get("Content-Disposition")
        ?.match(/filename\*=UTF-8''([^;]+)/)?.[1]
      anchor.href = url
      anchor.download = file ? decodeURIComponent(file) : "writing." + format
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      notify("Document downloaded.")
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="export-panel workspace-options">
      <summary>Download writing</summary>
      <p className="hint">
        Your latest edits are saved before export. Page numbers, chapter breaks
        and format-specific script layout are included.
      </p>
      <div className="form-grid">
        <label className="field">
          Format
          <select
            disabled={busy}
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            <option value="docx">Word document</option>
            <option value="pdf">PDF</option>
            {packet === "manuscript" && (
              <>
                <option value="txt">Plain text</option>
                <option value="md">Markdown</option>
                {["Screenplay", "Television script"].includes(
                  project.brief.medium,
                ) && <option value="fountain">Fountain screenplay</option>}
              </>
            )}
          </select>
        </label>
        <label className="field">
          Contents
          <select
            disabled={busy}
            value={packet}
            onChange={(e) => {
              setPacket(e.target.value)
              if (!["docx", "pdf"].includes(format)) setFormat("docx")
            }}
          >
            <option value="manuscript">Writing only</option>
            <option value="project">Project dossier</option>
          </select>
        </label>
        {sceneId && (
          <label className="field">
            Scope
            <select
              disabled={busy}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="all">Whole manuscript</option>
              <option value="chapter">Current chapter or scene</option>
            </select>
          </label>
        )}
      </div>
      <p className="hint">
        A project dossier also includes your brief, characters, story canon and
        latest research.{" "}
        <HelpTip label="About document privacy">
          Downloads contain private project details. Review the document before
          sharing it outside your team.
        </HelpTip>
      </p>
      {error && (
        <p role="alert" className="live-status error">
          {error}
        </p>
      )}
      <button
        className="primary"
        disabled={busy || !project.id}
        onClick={() => void download()}
      >
        {busy ? "Preparing document…" : "Download document"}
      </button>
    </details>
  )
}
