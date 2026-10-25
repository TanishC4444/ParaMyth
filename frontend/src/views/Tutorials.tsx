import { useState } from "react"
import { PageTitle, Icon } from "../ui"
import { useStudio } from "../store"
import { useAccess } from "../AccountGate"
import type { View } from "../types"

const lessons = [
  {
    id: "start",
    title: "Start a project",
    time: "2 min",
    view: "projects",
    action: "Open projects",
    steps: [
      "Choose New project, give it a title and pick the format you want to write. Documentary, screenplay and prose use different writing conventions.",
      "Add an idea in Write chapters. A sentence or a few bullet points are enough.",
      "Choose Start writing to use your idea as given, or Develop my idea to review optional additions. Nothing is published to Discovery automatically.",
    ],
  },
  {
    id: "write",
    title: "Write and revise chapters",
    time: "3 min",
    view: "workflow",
    action: "Open writing",
    steps: [
      "Your idea is on the left and the draft appears on the right. Earlier saved chapters guide continuity.",
      "Use the revision box beside the draft to describe a change. Suggest revisions gives feedback; Apply revisions creates a revised version. You can return to earlier draft versions.",
      "Save & next chapter keeps this chapter and opens a fresh idea box. Download writing gives you Word, PDF or a format suited to your script.",
    ],
  },
  {
    id: "research",
    title: "Prepare a documentary",
    time: "3 min",
    view: "workflow",
    tool: "research",
    action: "Open research",
    steps: [
      "Open Research in Visuals, sound & production. Enter a real-world topic, place, period and the questions you want to explore.",
      "Find sources retrieves live SerpAPI search leads and can develop interview questions, sequence ideas and a verification checklist. It does not verify full pages or invent testimony.",
      "Follow source links, check original evidence and resolve conflicting accounts. Use in idea adds the report only when you choose it. Download the dossier to keep your source register.",
    ],
  },
  {
    id: "media",
    title: "Create visuals and sound",
    time: "2 min",
    view: "workflow",
    tool: "images",
    action: "Open creative tools",
    steps: [
      "The source selector follows your latest writing. New requests use the writing available when you start them.",
      "For a visual, describe a character, place or scene. Create visual prepares and renders it in one action; Prompt options lets you review the prompt first.",
      "For sound, describe instruments, pace and mood. Automatic settings choose the format and duration. Switch them off to choose these yourself. These are creative outputs, not factual documentary evidence.",
    ],
  },
  {
    id: "production",
    title: "Plan a production",
    time: "3 min",
    view: "workflow",
    tool: "production",
    action: "Open production",
    steps: [
      "Use your writing or type a production brief. Create production plan proposes the approach, schedule, budget and practical tasks.",
      "Automatic selection includes your latest finished visuals and soundtrack direction. Open Reference choices to use specific assets.",
      "Review assumptions and source leads before booking or budgeting. Download the complete PDF or Word dossier, or export the schedule, budget and calendar separately.",
    ],
  },
  {
    id: "share",
    title: "Share and collaborate",
    time: "2 min",
    view: "discovery",
    action: "Open discovery",
    steps: [
      "Team settings lets an owner invite collaborators. A team project is shared with that team; personal projects stay personal.",
      "Discovery shares a separate post about a project, story or character. Choose exactly what text to include, preview it and confirm publication.",
      "Other signed-in members can read your post and copy its link. You can edit or withdraw your posts. Withdrawing a post does not delete your private project.",
    ],
  },
  {
    id: "save",
    title: "Keep and download your work",
    time: "2 min",
    view: "workflow",
    action: "Open project workspace",
    steps: [
      "Draft fields save as you work. Check the saved status in the header before closing the page. A connection warning means changes still need attention.",
      "Generation continues while you move between tools. Activity shows running jobs, and completed results remain in the project. A server restart can interrupt a job; the app keeps partial writing where available.",
      "Download writing offers a manuscript or a project dossier with the brief, characters, canon and latest research. Exporting does not publish anything.",
    ],
  },
  {
    id: "access",
    title: "Use the keyboard and find help",
    time: "1 min",
    view: "connections",
    action: "Check connections",
    steps: [
      "Use Tab to move through controls, Enter or Space to activate them, and Escape to close dialogs. The skip link jumps past navigation.",
      "Information buttons open short explanations with a tap or keyboard. Optional settings stay collapsed until you need them.",
      "If generation is unavailable, open Connections. Shared provider keys are managed by the studio owner. Your account password and private project text are never requested by a help bubble.",
    ],
  },
] as const

export default function Tutorials({
  standalone = false,
}: {
  standalone?: boolean
}) {
  const { go, project, setDraft } = useStudio(),
    access = useAccess()
  const [selected, setSelected] = useState("start")
  const lesson = lessons.find((item) => item.id === selected) || lessons[0]
  const open = () => {
    if ("tool" in lesson && project.id) {
      setDraft(project.id, "workflow.section", "media")
      setDraft(project.id, "workflow.tool", lesson.tool)
    }
    go(
      lesson.view === "workflow" && !project.id
        ? "projects"
        : lesson.view as View,
    )
  }
  return (
    <div
      className={
        standalone ? "night-page tutorial-public" : "page tutorials-page"
      }
    >
      {standalone && <a href="#/">Back to ParaMyth</a>}
      <PageTitle
        title="Tutorials"
        eyebrow="GETTING STARTED"
        text="Short guides to writing, research and production. Pick the task you want to do."
      />
      <div className="tutorial-layout">
        <nav aria-label="Tutorial topics">
          {lessons.map((item) => (
            <button
              key={item.id}
              aria-current={selected === item.id ? "step" : undefined}
              onClick={() => setSelected(item.id)}
            >
              <span>{item.title}</span>
              <small>{item.time}</small>
            </button>
          ))}
        </nav>
        <article className="panel tutorial-lesson" aria-live="polite">
          <span className="eyebrow">{lesson.time} READ</span>
          <h2>{lesson.title}</h2>
          <ol>
            {lesson.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <button className="primary" onClick={open}>
            {standalone && !access.authenticated
              ? "Open the studio"
              : lesson.action}
            <Icon name="arrow" size={16} />
          </button>
        </article>
      </div>
    </div>
  )
}
