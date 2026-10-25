# ParaMyth frontend-pipeline

React and TypeScript frontend-pipeline exported from [ParaMyth — Creative Workspace in Figma Make](https://www.figma.com/make/y84RroZNeQasHQYubnysx8/ParaMyth-%E2%80%94-Creative-Workspace).

The export includes the original interface source, styles, and supplied ParaMyth artwork. The Vite configuration and HTML shell are adapted for standalone development; Figma's preview hooks, agent instructions, and hosting metadata are not required here.

## Run locally

The root page is a standalone, sidebar-free landing page with collected artwork
and an interactive 3D story atlas. `/#/atlas` opens the atlas on that page;
`/#/overview` opens the existing studio. Hash routes support reloads and browser
Back/Forward without special server rewrites. Drag the
globe to rotate, use the zoom buttons, or focus the globe and use arrow keys,
plus/minus, and Home. Numbered rings retain tradition colors and open a list of
their stories (including tales at the same location). Search covers all matching
stories, including those on the far side of the globe. The existing filters,
record details, episode actions, project pins, and creative-workspace handoffs
use the same atlas data as before. Project activity remains in the studio Overview.

Twelve existing licensed library images are reused in the landing composition,
project covers, story inspiration, and the creative/image/music empty states.
The original WebP files are unchanged; CSS handles crops, masks, overlays and
subtle motion. The landing animation has a pause control and respects reduced
motion. No new stock images or generated artwork were used. Complete source and
license records are in `public/art/manifest.json`; the landing footer exposes
text credits. These reference images are never presented as generated results.

The supplied ParaMyth logo is preserved in `public/brand/paramyth-logo.png` and
used by the landing, studio and account screen. The account page at
`/studio/teams.html` shares the cream/navy/sage styling and uses the collected
castle landscape. Its account/team forms and authentication code are unchanged.
The Vite dev server serves the existing `web/` pages under `/studio` to match
the production launcher; authentication still requires the studio API, which
the frontend-pipeline development server does not provide.

The borderless globe uses Three.js, a locally generated 4K map texture, bundled
Natural Earth 1:50m coastlines and countries, plus real river and lake geometry.
Country tints, blue water, and zoom-aware place labels provide a colorful map
treatment. The tradition filters flow underneath the globe; the story panel
shares the page background. Geography sources are recorded in
`public/atlas/GEOGRAPHY.md`. There are no external globe map tiles.
It renders only when its view changes, does not auto-rotate, and
disposes its GPU resources when leaving the page. If WebGL or world geometry
cannot load, search and story records remain available and the user can choose
the existing flat map. The flat-map library loads only when selected.

Use Node.js 22.12+ (or Node.js 24) and pnpm.

```sh
cd frontend-pipeline
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL printed by Vite.

```sh
pnpm exec tsc --noEmit
pnpm build
pnpm preview
```

The production build is written to `frontend-pipeline/dist/`. Serve it at the origin root; the exported app uses root-relative asset URLs.

## Included

The interface follows the ParaMyth feature catalog, on the ParaMyth brand:

- **Overview** — current project progress, runner capacity (2 workers, 4 queued or running), and scenes awaiting acceptance.
- **Projects** — create from a brief (six media, with premise-based medium detection), search and filter by medium and manuscript state.
- **Project workspace**
  - *Brief*: premise, medium, genre, tone, POV, themes, immutable world rules, must-avoid constraints, chapter/scene counts, guided or strict scene length, and deep character design (goal, fear, voice, four-step arc). Validation and JSON export.
  - *Manuscript*: scenes by chapter with Draft / Provisional / In review / Accepted states; deterministic local checks (length, must-avoid terms, repetition, screenplay and audio-drama form); evidence-quoted findings by story, rhetoric and memory dimension; acceptance blocked by open blocking findings and bound to a prose hash; Partial / Provisional / Final exports; checkpoints.
  - *Canon & memory*: fact ledger (event, belief, claim, resource, relationship, thread) with knowledge holders, provisional facts promoted on scene acceptance, quarantine, and thread setup / escalation / payoff.
  - *Pipeline*: dispatch sequential, deep planned parallel, parallel scene reconciler, living universe or classic expansion runs.
- **Story atlas** — the 385 enabled top-level works of the literary corpus on an interactive world map (Leaflet, Natural Earth 1:50m land and borders, Esri shaded relief when reachable). Pins sit where a tale is set or where it was told, collected or composed, and cluster with rings showing which traditions they hold; search, tradition filters and an in-view list. Selecting a story loads its record (summary, story engine, characters, episodes and provenance). *Ideate on this story* and *Draw inspiration* open the creative workspace seeded with a retelling or engine-only brief and the record as context; episodes can be used the same way, and stories can be pinned to the current project as explicit references. Results adopted as a project keep that pin.
- **Pipelines & runs** — run history with stage progress, event timelines, cancel and fresh recovery.
- **Creative workspace** — Ideas / Draft / Review / Revise with 100–3000 word targets, 1–3 rounds and optional story context; results can be revised or adopted as a project. Idea board.
- **Literary retrieval** — focused / balanced / combinatory search over a corpus sample with semantic, keyword and mechanism weights that must sum to one, adaptation controls and pinned references by scope.
- **Images** — six subjects, story-aware prompt preparation, Muse primary with optional Vultr backup, automatic or overridden style, natural finish, provenance per render.
- **Soundtracks** — cue planning from scene text; ambient soundscapes synthesized in the browser as WAV (wind, water, rumble, fire); score and song requests wait for a provider.
- **Production** — constraints, editable breakdown, deterministic single-unit schedule with a night turnaround buffer, decimal low/high budget with contingency and cap, and schedule.csv, budget.csv, tasks.csv, calendar.ics, call-sheets.txt and plan.json exports.
- **File library** and **Connections** — per-project records with previews and downloads; studio API health check and a link to the studio's own connections page.

## Prototype boundaries

This is a local demo. Projects, runs, creative results and media records are stored in this browser's `localStorage` under `paramyth-studio-v3`; the API base URL is remembered separately. Runs advance on a simulated timer, creative output is a local template, and image renders are placeholders, so none of these call a model or GitHub. Ambient audio, local checks, schedules, budgets and exports are computed for real in the browser. The Connections page only checks `/api/v1/health` on a running studio; credentials are never entered or stored here. Demo identities and roles do not provide authentication.

The story atlas reads `GET /api/v1/atlas/stories` and `/api/v1/atlas/stories/{id}` from the same origin, then from the API base saved on Connections. These routes read `data/literary_rag.db` with map anchors from `data/atlas-places.json`. Without a reachable API it falls back to `public/atlas/stories.json`, an export of the same database; regenerate it with `python -m scripts.export_atlas` after rebuilding the RAG index or editing the anchors (`tests/test_atlas.py` fails when it is stale). Anchors are approximate, model-authored traditional locations, not verified geography.

After `pnpm build`, the local launcher `python -m scripts.run_studio` serves this
frontend-pipeline at `http://127.0.0.1:8767/`. Its **Studio accounts & teams** link opens the
Tiger-backed account and collaboration screen at `/studio/teams.html`. API routes
remain available under `/api/v1`. The React demo's projects and simulated runs
remain browser-local; merging and serving the UI does not migrate those records
to Tiger Data.
