import { useStudio, useDraftState } from "./store"
import type { View } from "./types"
export default function Journey() {
  const { project, view, go, jobs, mediaDirection, setMediaDirection } =
    useStudio()
  const [sceneId, setSceneId] = useDraftState("shared.scene", "")
  const active = jobs.filter((j) => ["running", "queued"].includes(j.status))
  return (
    <section className="journey journey-compact" aria-label="Your story workspace">
      <div>
        <strong>
          {project.id ? project.title : "Choose or create a story"}
        </strong>
        <button className="text-action" onClick={() => go("projects")}>
          Change
        </button>
      </div>
      <nav aria-label="Make your story">
        {([
          ["project", "Write"],
          ["images", "Add visuals"],
          ["music", "Add sound"],
          ["production", "Plan production"],
        ] as [View, string][]).map(([id, name]) => (
          <button
            key={id}
            aria-current={view === id ? "page" : undefined}
            onClick={() => go(id)}
          >
            {name}
          </button>
        ))}
      </nav>
      {active.length > 0 && (
        <p role="status">
          Your{" "}
          {active
            .map((j) => j.kind)
            .filter((v, i, a) => a.indexOf(v) === i)
            .join(" and ")}{" "}
          work is running. Results will be saved here.
        </p>
      )}
      {["images", "music", "production"].includes(view) && (
        <details className="journey-context">
          <summary>{mediaDirection ? "Scene & direction · customized" : "Scene & direction"}</summary>
        <div className="journey-direction">
          <label>
            Focus on a scene
            <select
              aria-label="Shared source scene"
              onChange={(e) => {
                setSceneId(e.target.value)
                const s = project.scenes.find((x) => x.id === e.target.value)
                setMediaDirection(
                  s ? `${s.title}: ${s.content.slice(0, 700)}` : "",
                )
              }}
              value={project.scenes.some((s) => s.id === sceneId) ? sceneId : ""}
            >
              <option value="">Whole story</option>
              {project.scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Creative direction{" "}
            <input
              value={mediaDirection}
              onChange={(e) => setMediaDirection(e.target.value)}
              placeholder="A scene, mood, or detail to carry through visuals, sound and planning"
              maxLength={1000}
            />
          </label>
        </div>
        </details>
      )}
    </section>
  )
}
