# ParaMyth frontend

React and TypeScript frontend exported from [ParaMyth — Creative Workspace in Figma Make](https://www.figma.com/make/y84RroZNeQasHQYubnysx8/ParaMyth-%E2%80%94-Creative-Workspace).

The export includes the original interface source, styles, and supplied ParaMyth artwork. The Vite configuration and HTML shell are adapted for standalone development; Figma's preview hooks, agent instructions, and hosting metadata are not required here.

## Run locally

Use Node.js 22.12+ (or Node.js 24) and pnpm.

```sh
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL printed by Vite.

```sh
pnpm exec tsc --noEmit
pnpm build
pnpm preview
```

The production build is written to `frontend/dist/`. Serve it at the origin root; the exported app uses root-relative asset URLs.

## Included

The interface covers the full ParaMyth studio:

- **Overview** — current project progress, runner capacity (2 workers, 4 queued or running), and scenes awaiting acceptance.
- **Projects** — create from a brief (six media, with premise-based medium detection), search and filter by medium and manuscript state.
- **Project workspace**
  - *Brief*: premise, medium, genre, tone, POV, themes, immutable world rules, must-avoid constraints, chapter/scene counts, guided or strict scene length, and deep character design (goal, fear, voice, four-step arc). Validation and JSON export.
  - *Manuscript*: scenes by chapter with Draft / Provisional / In review / Accepted states; deterministic local checks (length, must-avoid terms, repetition, screenplay and audio-drama form); evidence-quoted findings by story, rhetoric and memory dimension; acceptance blocked by open blocking findings and bound to a prose hash; Partial / Provisional / Final exports; checkpoints.
  - *Canon & memory*: fact ledger (event, belief, claim, resource, relationship, thread) with knowledge holders, provisional facts promoted on scene acceptance, quarantine, and thread setup / escalation / payoff.
  - *Pipeline*: dispatch sequential, deep planned parallel, parallel scene reconciler, living universe or classic expansion runs.
- **Pipelines & runs** — run history with stage progress, event timelines, cancel and fresh recovery.
- **Creative workspace** — Ideas / Draft / Review / Revise with 100–3000 word targets, 1–3 rounds and optional story context; results can be revised or adopted as a project. Idea board.
- **Literary retrieval** — focused / balanced / combinatory search over a corpus sample with semantic, keyword and mechanism weights that must sum to one, adaptation controls and pinned references by scope.
- **Images** — six subjects, story-aware prompt preparation, Muse primary with optional Vultr backup, automatic or overridden style, natural finish, provenance per render.
- **Soundtracks** — cue planning from scene text; ambient soundscapes synthesized in the browser as WAV (wind, water, rumble, fire); score and song requests wait for a provider.
- **Production** — constraints, editable breakdown, deterministic single-unit schedule with a night turnaround buffer, decimal low/high budget with contingency and cap, and schedule.csv, budget.csv, tasks.csv, calendar.ics, call-sheets.txt and plan.json exports.
- **File library** and **Connections** — per-project records with previews and downloads; studio API health check and a link to the studio's own connections page.

## Prototype boundaries

This is a local demo. Projects, runs, creative results and media records are stored in this browser's `localStorage` under `paramyth-studio-v3`; the API base URL is remembered separately. Runs advance on a simulated timer, creative output is a local template, and image renders are placeholders, so none of these call a model or GitHub. Ambient audio, local checks, schedules, budgets and exports are computed for real in the browser. The Connections page only checks `/api/v1/health` on a running studio; credentials are never entered or stored here. Demo identities and roles do not provide authentication.

The existing `web/` playground and backend remain separate. This commit does not change their deployment or publish the new frontend.
