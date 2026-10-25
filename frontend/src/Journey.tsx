import { useStudio } from "./store"
import type { View } from "./types"
export default function Journey() {
  const { project, view, go, jobs, mediaDirection, setMediaDirection } =
    useStudio()
  const active = jobs.filter((j) => ["running", "queued"].includes(j.status))
  return (
    <section className="journey" aria-label="Your story workspace">
      <div>
        <span className="eyebrow">ONE STORY, EVERY POSSIBILITY</span>
        <strong>
          {project.id ? project.title : "Choose or create a story"}
        </strong>
        <button className="text-action" onClick={() => go("projects")}>
          Change story
        </button>
      </div>
      <nav aria-label="Make your story">
        {([
          ["project", "Write"],
          ["images", "Add visuals"],
          ["music", "Add sound"],
          ["production", "Plan production"],
        ] as [View, string][]).map(([id, name], i) => (
          <button
            key={id}
            aria-current={view === id ? "page" : undefined}
            onClick={() => go(id)}
          >
            <small>0{i + 1}</small>
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
          work is running. Keep shaping your story here; results will be saved
          to this project.
        </p>
      )}
      {["images", "music", "production"].includes(view) && (
        <div className="journey-direction">
          <label>
            Focus on a scene
            <select
              aria-label="Shared source scene"
              onChange={(e) => {
                const s = project.scenes.find((x) => x.id === e.target.value)
                setMediaDirection(
                  s ? `${s.title}: ${s.content.slice(0, 700)}` : "",
                )
              }}
              defaultValue=""
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
      )}
    </section>
  )
}
