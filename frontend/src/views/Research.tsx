import { useEffect, useState } from "react"
import { api, projectPath } from "../api"
import { useDraftState, useStudio } from "../store"
import { useSavedJob } from "../useSavedJob"
import { errorText, PageTitle, fmtDate } from "../ui"
import { HelpTip } from "../Guide"
import { useAccess } from "../AccountGate"

type Source = {
  id: string
  title: string
  url: string
  snippet: string
  verification: string
}
type Report = {
  id: string
  created_at: string
  config: { topic: string; place: string; period: string; questions: string }
  sources: Source[]
  outline: any
  warnings: string[]
  notice: string
  status: string
}
export default function Research() {
  const { project, drafts, flush, setDraft, go, notify } = useStudio(),
    { studio } = useAccess()
  const [topic, setTopic] = useDraftState("research.topic", ""),
    [place, setPlace] = useDraftState("research.place", ""),
    [period, setPeriod] = useDraftState("research.period", ""),
    [questions, setQuestions] = useDraftState("research.questions", ""),
    [synthesize, setSynthesize] = useDraftState("research.synthesize", true)
  const [reports, setReports] = useState<Report[]>([]),
    [selected, setSelected] = useDraftState("research.selected", ""),
    [submitting, setSubmitting] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [loading, setLoading] = useState(true),
    [available, setAvailable] = useState(true)
  const path = (value: string) => projectPath(value, project.id)
  const load = async () => {
    const value = await api<{ reports: Report[]; search_available: boolean }>(
      path("/api/ui/research"),
    )
    setReports(value.reports)
    setAvailable(value.search_available)
  }
  const [handle, setHandle] = useSavedJob("research.pending", ["research"], {
    progress: (job) => {
      setStatus(job.message)
      setError("")
    },
    complete: async (job) => {
      await load()
      setSelected(job.result.id)
      setStatus(
        "Research saved. Review the original sources before using factual claims.",
      )
    },
    failed: (message) => {
      setError(message)
      setStatus("")
    },
  })
  useEffect(() => {
    let active = true
    setReports([])
    setLoading(true)
    setError("")
    void api<{ reports: Report[]; search_available: boolean }>(
      path("/api/ui/research"),
    )
      .then((value) => {
        if (active) {
          setReports(value.reports)
          setAvailable(value.search_available)
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [project.id])
  const start = async () => {
    if (handle || submitting) return
    setSubmitting(true)
    setError("")
    try {
      await flush()
      const job = await api<{ job_id: string }>(path("/api/ui/research"), {
        topic,
        place,
        period,
        questions,
        synthesize,
      })
      setHandle({ id: job.job_id, kind: "research" })
      setStatus("Finding source leads. You can keep working in other tools.")
    } catch (e) {
      setError(errorText(e))
    } finally {
      setSubmitting(false)
    }
  }
  const report = reports.find((item) => item.id === selected) || reports[0],
    outline = report?.outline || {},
    busy = submitting || !!handle
  const useInIdea = () => {
    if (!report) return
    const chapter = Number(drafts[project.id]?.["writing.chapter"]) || 1
    const note = [
      "Documentary research topic: " + report.config.topic,
      report.notice,
      outline.angle && "Proposed approach: " + outline.angle,
      ...(outline.claims || []).map(
        (claim: any) =>
          "PROVISIONAL: " +
          claim.text +
          " [" +
          claim.source_ids.join(", ") +
          "]. Verify: " +
          claim.check,
      ),
      ...report.sources.map(
        (source) => source.id + ": " + source.title + " " + source.url,
      ),
    ]
      .filter(Boolean)
      .join("\n")
    // Retain the author's existing idea. Adding evidence is an explicit action.
    const key =
      chapter === 1 ? "creative.input" : `creative.chapter${chapter}.input`
    const existing = String(drafts[project.id]?.[key] || "")
    if (existing.length + note.length + 2 > 20000) {
      notify(
        "Your idea is near its text limit. Download the research dossier or shorten the idea before adding it.",
      )
      return
    }
    setDraft(project.id, key, [existing, note].filter(Boolean).join("\n\n"))
    setDraft(project.id, "workflow.section", "writing")
    setDraft(project.id, "workflow.writing", "creative")
    go("workflow")
    notify(
      "Research added to your idea. Review the factual claims before writing.",
    )
  }
  const citations = (ids: string[] = []) =>
    ids.map((id) => {
      const source = report?.sources.find((item) => item.id === id)
      return source ? (
        <a key={id} href={source.url} target="_blank" rel="noreferrer">
          [{id}]
        </a>
      ) : null
    })
  return (
    <div className="page simple-workspace research-page">
      <PageTitle
        level="h2"
        title="Documentary research"
        text="Find real-world source leads and develop a documentary around the evidence."
      >
        <HelpTip label="How documentary research works">
          SerpAPI finds source snippets. Your connected writing model proposes
          questions and a structure using those leads. Neither step
          independently verifies a factual claim.
        </HelpTip>
      </PageTitle>
      {error && (
        <p role="alert" className="live-status error">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="live-status">
          {status}
        </p>
      )}
      <div className="research-layout">
        <section className="panel research-form">
          <h3>What do you want to investigate?</h3>
          <label className="field">
            Topic
            <input
              disabled={busy}
              maxLength={250}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="For example: how a city recovered its lost river"
            />
          </label>
          <label className="field">
            Questions to explore · optional
            <textarea
              maxLength={2500}
              disabled={busy}
              value={questions}
              onChange={(e) => setQuestions(e.target.value)}
              placeholder="What do you need to understand? Whose perspectives are missing?"
            />
          </label>
          <details className="workspace-options">
            <summary>Place, period and research options</summary>
            <label className="field">
              Place
              <input
                value={place}
                disabled={busy}
                maxLength={160}
                onChange={(e) => setPlace(e.target.value)}
              />
            </label>
            <label className="field">
              Time period
              <input
                value={period}
                disabled={busy}
                maxLength={120}
                onChange={(e) => setPeriod(e.target.value)}
              />
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={synthesize}
                disabled={busy}
                onChange={(e) => setSynthesize(e.target.checked)}
              />
              Develop interview questions and an outline
            </label>
          </details>
          <p className="hint">
            Your topic, place and period are sent to search. Private manuscript
            text is not sent to SerpAPI. Each request uses up to four searches;
            cached results are reused.
          </p>
          {!available && (
            <p className="hint">
              Web research is unavailable until the studio owner connects
              search. Saved research remains available.
            </p>
          )}
          <button
            className="primary"
            disabled={
              busy || !topic.trim() || !available || studio?.role === "viewer"
            }
            onClick={() => void start()}
          >
            {busy ? "Researching…" : "Find sources & prepare"}
          </button>
        </section>
        <section className="research-results" aria-label="Saved research">
          {loading && <p role="status">Loading saved research…</p>}
          {reports.length > 1 && (
            <label className="field">
              Research report
              <select
                value={report?.id || ""}
                onChange={(e) => setSelected(e.target.value)}
              >
                {reports.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.config.topic} · {fmtDate(item.created_at)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {report ? (
            <article className="panel">
              <h3>{report.config.topic}</h3>
              <p className="hint">{report.notice}</p>
              {report.warnings.map((warning) => (
                <p key={warning} className="hint">
                  {warning}
                </p>
              ))}
              {outline.angle && (
                <>
                  <h4>Proposed approach</h4>
                  <p>{outline.angle}</p>
                </>
              )}
              <div className="comment-actions">
                <button
                  disabled={studio?.role === "viewer"}
                  onClick={useInIdea}
                >
                  Use in idea
                </button>
                <a
                  className="secondary"
                  href={path(
                    "/api/ui/research/" + report.id + "/export?format=pdf",
                  )}
                >
                  Download PDF
                </a>
                <a
                  className="secondary"
                  href={path(
                    "/api/ui/research/" + report.id + "/export?format=docx",
                  )}
                >
                  Download Word
                </a>
              </div>
              {!!outline.claims?.length && (
                <details open>
                  <summary>Claims to verify · {outline.claims.length}</summary>
                  {outline.claims.map((claim: any, i: number) => (
                    <div className="research-entry" key={i}>
                      <p>
                        {claim.text} {citations(claim.source_ids)}
                      </p>
                      <p className="hint">Check: {claim.check}</p>
                    </div>
                  ))}
                </details>
              )}
              {!!outline.interviews?.length && (
                <details>
                  <summary>Interview proposals</summary>
                  {outline.interviews.map((item: any, i: number) => (
                    <div className="research-entry" key={i}>
                      <h4>{item.role}</h4>
                      <p>{item.why}</p>
                      <ul>
                        {item.questions.map((question: string) => (
                          <li key={question}>{question}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </details>
              )}
              {!!outline.sequences?.length && (
                <details>
                  <summary>Sequence outline</summary>
                  {outline.sequences.map((item: any, i: number) => (
                    <div className="research-entry" key={i}>
                      <h4>{item.title}</h4>
                      <p>
                        <b>Video:</b> {item.video}
                      </p>
                      <p>
                        <b>Audio:</b> {item.audio} {citations(item.source_ids)}
                      </p>
                    </div>
                  ))}
                </details>
              )}
              {!!outline.timeline?.length && (
                <details>
                  <summary>Provisional timeline</summary>
                  {outline.timeline.map((item: any, i: number) => (
                    <p key={i}>
                      <b>{item.period}</b> · {item.event}{" "}
                      {citations(item.source_ids)}
                    </p>
                  ))}
                </details>
              )}
              {!!outline.open_questions?.length && (
                <details>
                  <summary>Evidence gaps and questions</summary>
                  <ul>
                    {outline.open_questions.map((item: string) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </details>
              )}
              {!!outline.archive_leads?.length && (
                <details>
                  <summary>Archive leads</summary>
                  {outline.archive_leads.map((item: any, i: number) => (
                    <p key={i}>
                      {item.task} {citations(item.source_ids)}
                    </p>
                  ))}
                </details>
              )}
              {!!outline.care?.length && (
                <details>
                  <summary>Consent, access and rights</summary>
                  <ul>
                    {outline.care.map((item: string) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </details>
              )}
              <details open>
                <summary>Source register · {report.sources.length}</summary>
                {report.sources.map((source) => (
                  <div key={source.id} className="research-entry">
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.id} · {source.title} ↗
                    </a>
                    <p>{source.snippet}</p>
                    <small>{source.verification}</small>
                  </div>
                ))}
              </details>
            </article>
          ) : (
            !loading && (
              <div className="panel empty">
                <h3>Start with a question</h3>
                <p>
                  Your sources and documentary preparation will stay with this
                  project.
                </p>
              </div>
            )
          )}
        </section>
      </div>
    </div>
  )
}
