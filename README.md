# ParaMyth

Early backend foundations for a file-backed storytelling workflow.

## Included

- Validated story requests, scene plans, reviews, and memory updates.
- Atomic JSON writes and a single-writer lock for run folders.
- Deterministic fixtures for testing coordination without model calls.

## Run checks

Requires Python 3.11 or newer. Core tests need no third-party dependencies.
Hybrid retrieval tests require the optional `rag` dependencies and skip when those
are absent. All tests use local fixtures or mocked providers; no credentials or
network calls are needed.

```sh
python -X utf8 -m unittest discover -s tests -v
```

The backend-tests workflow checks contracts and storage on Python 3.11 and 3.12. The fixture-checks workflow checks fixture responses against the contracts.

The sequential coordinator supports plan approval, bounded retries, character-scoped memory, atomic scene acceptance, checkpoints, chapter export, and resumable runs. Retrieval and role transports can be injected. An explicit HTTPS chat-completions adapter is available. Fixture output is synthetic test data, not generated fiction.

## Frontend

The React studio and story atlas live in `frontend/`. See `frontend/README.md`
for setup (Node.js 22.12+ and pnpm).

## Start and resume

```sh
python -m paramyth.cli --request example.json --out runs/harbor
python -m paramyth.cli --out runs/harbor --resume --approve-plan --stop-after 2
python -m paramyth.cli --out runs/harbor --resume
```

Review `plan.json` before approving it. Rejected drafts stay under `work/`; accepted scenes and memory are committed together in `state.json`. Changing a request requires a new run folder. Completed runs can be resumed without repeating accepted work.

## Live scenes and benchmarks

The live adapter requires `PARAMYTH_BASE_URL` (an HTTPS API base URL ending in `/v1`),
`PARAMYTH_MODEL`, and `PARAMYTH_API_KEY` in the environment. No provider or paid model
is selected automatically. It sends chat-completions requests with a
`max_completion_tokens` limit; endpoint/model compatibility must be checked by a live run.
Keys are not stored in run files. Do not put keys in requests or command arguments.

```sh
python -m paramyth.cli --backend live --request example.json --out runs/live
python -m paramyth.cli --backend live --out runs/live --resume --approve-plan --stop-after 1
python -m paramyth.benchmark --backend live --case single --out runs/live-single
```

Live benchmarks also accept `sequence` (three scenes) and `resume` (stop after one
accepted scene, then verify its prefix is unchanged on continuation). Run `single`
first and inspect the prose and reviews before larger runs. Fixtures exercise the
same orchestration without network calls. Neither fixture success nor model review
establishes literary quality.

Character proposals use isolated character packets. Only the viewpoint character's
proposal reaches the director, so other actors' private proposals cannot leak into
writer direction. All proposals remain separate from accepted canon. Source-bound
review assessments cover continuity, viewpoint and scene change; memory assessment
covers evidence and knowledge. Repairs remain bounded.

Provider 5xx failures have at most two retries. Authentication and rate-limit errors
open a cooldown; ambiguous connection failures stop without duplicating generation.
Resume after resolving configuration or waiting for provider recovery. There is no
silent provider/model fallback. Endpoint, model and output budget are pinned on resume.
`attempts/` retains timing, finish reasons, available usage and redacted provider
attempt diagnostics. Missing usage stays unknown. No prompt bodies or keys enter those
provider diagnostics. Context enforcement is a character budget, not tokenizer-based.

**Live scene benchmark** is manual-only. Configure repository secret
`PARAMYTH_API_KEY` and variables `PARAMYTH_BASE_URL` and `PARAMYTH_MODEL` first.
It runs one scene before the three-scene and checkpoint cases and retains outputs
on failure. Missing configuration fails preflight without contacting a provider.

## Retrieval and persistent canon

Build a local keyword index from your own JSON corpus (objects with `id`, `title`,
and `text`):

```sh
python -m paramyth.retrieval --corpus corpus.json --out corpus.db
```

Put `retrieval_index` in the story request and optionally pin the printed digest
as `corpus_hash`. Results retain source IDs, excerpts, index version and corpus
fingerprint. A mismatched version/hash is rejected. Retrieval is frozen in the run
checkpoint; resuming does not silently change its sources. The command above
builds the dependency-free FTS5 keyword index.

### Hybrid retrieval

Install the optional dependencies and set `GEMINI_API_KEY` in your environment
or a local `.env` in the working directory. Environment values take precedence.
The encoder uses `gemini-embedding-001` with normalized 768-dimensional vectors
and separate document/query task types. Ingestion sends corpus projections to
Gemini; hybrid search sends the query. Both can incur provider charges.

```sh
python -m pip install '.[rag]'
python -m paramyth.rag.ingest --corpus examples/rag-corpus.json --out data/literary_rag.db
python -m paramyth.rag.search "a duty conflicts with a promise" --index data/literary_rag.db
```

The corpus can be a JSON array or an object containing `title` and `records`.
Each record needs a unique string `id` and a `title`. Supply `text` or literary
fields such as `summary`, `theme_keywords`, `narrative_mechanism`, and
`references.version_notes`. The included corpus contains synthetic examples.
Your existing keyword corpus format is accepted, but the two index formats are
separate: use a different output path for each.

Ingestion resumes completed batches, embeds changed projections only, refreshes
metadata, and removes deleted records after every batch succeeds. A failed build
remains unavailable to searches until ingestion completes. Use one ingestion
process per index and avoid ingesting while a search is running.

Set `"retrieval_mode": "hybrid"` and `"retrieval_index": "data/literary_rag.db"`
in a story request to use this index in the coordinator. Optionally set
`corpus_hash` to the digest printed by ingestion. Hybrid results keep source IDs,
excerpts, source limits, semantic and keyword ranks, encoder version, and corpus
hash. Existing run checkpoints retain their original retrieval packet on resume.
Hybrid mode requires an index or an explicitly injected retrieval provider.

The search command supports `--semantic-weight` from 0 to 1, `--record-type`,
`--location`, and `--adaptation-mode` (`Balanced`, `Focused adaptation`, or
`Combinatory`). A semantic weight of 0 searches the hybrid index with keywords
only and makes no provider calls. Disabled records are excluded. Ties use source
IDs for deterministic ordering. Semantic and keyword ranks are combined using
weighted reciprocal ranks; these scores are not confidence probabilities.
Search behavior is tested with synthetic vectors, not a retrieval-quality benchmark.

`PARAMYTH_RAG_DATABASE` supplies the default index path when `--out` or `--index`
is omitted. Relative paths resolve from the working directory. Run the full
offline test suite after installing the optional dependencies:

```sh
python -X utf8 -m unittest discover -s tests -v
```

`state.json` owns the append-only fact history; `canon.json` is a derived readable
projection. Fact updates explicitly supersede existing current records with matching
keys and kinds. Resource updates reconcile integer amounts and changes. Extracted
witnesses must participate; public knowledge needs an explicitly public scene.
Evidence must quote accepted prose. These checks validate structure and arithmetic,
not the semantic truth of a model's interpretation.

Actor visibility is applied before current-state projection. An absent character
can retain an older fact without gaining a later private update. Working context
prioritizes resources, relationships and unresolved threads; omitted IDs are explicit
and the full ledger remains in checkpoints.

## Parallel reviews and recovery

Character proposals execute independently; only the POV proposal reaches direction.
Story review, rhetoric review and memory extraction run concurrently against one
immutable prose hash. A changed repair invalidates all three results and refreshes
memory before independent verification. Canon commits remain sequential and atomic.

Scene drafts, completed review branches and stage checkpoints stay under `work/`.
Resume uses the same request/provider settings and accepted-state anchor. A failed
memory review can be retried within the configured stage retry budget without
regenerating the draft. Prose repair remains bounded by `max_repairs`; exhaustion
requires inspecting diagnostics and starting a revised request in a new run folder.
Custom transports must support concurrent calls. Hosted attempt diagnostics are
isolated per worker thread.

Completed scenes remain provisional until chapter checks and the whole-story audit
pass. `FINAL_STORY.txt` and compatibility `story.txt` are written only after final
acceptance; `PROVISIONAL_STORY.txt` remains available on failure. Whole-story audits
have bounded recovery. Very long whole-story inputs can exceed the configured
context budget; hierarchical long-book auditing is not implemented.

This run format uses schema version 2. Retain earlier run folders as historical
checkpoints and start a fresh folder rather than silently reinterpreting older state.

## Creative studio

`paramyth.creative` develops ideas, drafts prose, reviews it and revises it with
Vultr Serverless Inference (`muse-glimmer-30b`). Set `VULTR_INFERENCE_API_KEY` in
the process environment. Each call can incur provider charges.

```sh
python -m paramyth.creative --folder runs/harbor --request examples/creative-ideas.json
python -m paramyth.creative --folder runs/harbor --request examples/creative-ideas.json --stream
```

A request picks one `operation`: `ideas`, `draft`, `review`, `revise` or `loop`.
`loop` drafts (or starts from `text`), then reviews and revises for up to `rounds`
(1–3) and stops early when the critic passes. `words` sets the target length
(100–3000). With `use_story` (default true) the first three story artifacts from
the run folder are sent as context. `guidance_mode` is `suggest` (keep the idea and
offer up to three optional improvements) or `use_idea` (develop it as written).

Records are saved under `creative/` with every step, its output and token usage.
With `--stream`, partial text is saved as it arrives, so a dropped connection
keeps the words already received. Failed attempts are recorded as failed and are
not retried automatically. Inferred details stay editable proposals, never
accepted canon.

## Soundtracks

`paramyth.soundtracks` builds a sound cue from the run folder's story, characters
and world, then either renders it locally or asks Vultr for music.

```sh
python -m paramyth.soundtracks --folder runs/harbor plan --mode ambience
python -m paramyth.soundtracks --folder runs/harbor ambience --seconds 60 --out harbor.wav
python -m paramyth.soundtracks --folder runs/harbor create --mode score --model minimax-music3 --seconds 60
python -m paramyth.soundtracks --folder runs/harbor status music_<id>
python -m paramyth.soundtracks --folder runs/harbor download music_<id> --out harbor.mp3
```

`ambience` and the local drone `score` are synthesized on your machine as 16 kHz
mono WAV (wind, water, rumble and fire layers chosen from the story). They make
no provider calls, and the same cue always sounds the same. `create` starts a
Vultr score or song job and needs `VULTR_INFERENCE_API_KEY`; it can incur
charges. Scores are forced instrumental. Songs need lyrics when the model
requires them, and durations must fit the model's limits (5–360 seconds).
Cues and jobs are recorded under `soundtracks/`. Downloads are capped at 64 MB.

## Production planning

`paramyth.production` turns a story run folder into a draft shoot plan. Muse
Glimmer on Vultr breaks the story into at most 16 filmable scene units with
cast, lighting, dependencies, props, risks and estimated budget rows. A local
scheduler then places them on shoot days, and the budget is recalculated with
exact decimal arithmetic. Set `VULTR_INFERENCE_API_KEY`; each plan makes two
model calls and can incur charges.

```sh
python -m paramyth.production --folder runs/harbor --constraints examples/production-constraints.json
python -m paramyth.production --folder runs/harbor --image harbor-scene.png
```

Constraints set the filming `region`, `currency`, `start_date`, `timezone`, workday
hours, setup and move minutes, contingency percent, an optional `budget_cap`,
weekend skipping, blackout dates and cast or location unavailability. The
scheduler respects dependencies and availability, keeps day and night shoots
apart, adds a meal break by hour five and a 12-hour turnaround, and reports
scenes it cannot fit. Up to three PNG, JPEG or WebP scene images (5 MB each)
can guide scouting criteria; they never prove a real address or permission.

With a filming `region` and `SERPAPI_API_KEY` set, up to `search_limit` (0–3)
targeted web searches look for film offices, location libraries and permit
rules. Results are cached in `production/search-cache.sqlite` (24 hours, 6 for
legal), capped at `PARAMYTH_SEARCH_DAILY_LIMIT` searches a day (default 10), and
can fail over to comma-separated `SERPAPI_BACKUP_KEYS`. Keys are never stored.
Recommendations may name a real place only when a search result supports it,
and every cited result stays a lead to verify.

Export a saved plan as a tentative calendar, sheets or call sheets:

```sh
python -m paramyth.production_exports --plan runs/harbor/production/plans/<id>.json --kind calendar.ics --out harbor.ics
```

Kinds are `calendar.ics`, `schedule.csv`, `budget.csv`, `tasks.csv`,
`call-sheets.txt` and `plan.json`. Calendar events are marked tentative, and CSV
cells that start with `=`, `+`, `-` or `@` are quoted so spreadsheets don't run them.

`paramyth.calendar_sync.GoogleCalendar` adds a plan's shoot days to Google
Calendar only when asked. Events are private and tentative, with no attendees.
Their IDs come from the plan, so syncing again skips events already there.
Overlapping busy events are reported instead of booked over, and a failure
partway keeps the IDs already created. It reads `GOOGLE_CALENDAR_ACCESS_TOKEN`,
or refreshes with `GOOGLE_CALENDAR_REFRESH_TOKEN`, `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET`. Tokens stay in memory and are never written to plans.

Plans are saved under `production/plans/` as drafts. Rates are model estimates,
not quotes, and unknown costs are left out of totals. Permits, availability and
legal requirements always need verification. Install the `production` extra for
time-zone data on systems without it.

## Meta image generation

The image backend prepares story-aware prompts locally and generates one PNG per
request using Meta's `muse-image-1.0` model. It uses the Python standard library.
Set `MUSE_IMAGE_API_KEY` (or `MODEL_API_KEY`) in the process environment before
generation. The image backend does not load `.env` automatically.

Prepare a prompt from a run folder, inspect the saved request, then generate:

```sh
python -m paramyth.image_studio --folder runs/harbor prepare --request examples/image-brief.json --out runs/harbor/image-request.json
python -m paramyth.image_studio --folder runs/harbor generate --request runs/harbor/image-request.json
python -m paramyth.image_studio --folder runs/harbor gallery
```

The installed `paramyth-images` command offers the same operations. `prepare`
makes no provider calls. It selects story passages for the subject and applies
automatic or explicit art direction. Supported kinds are character, scene,
location, prop, storyboard, and custom. Set `use_story` to false with a subject or
direction to prepare a standalone image prompt. Story context reads an allowlist
of narrative files and excludes provider logs and environment files.

`generate` sends the prompt to Meta's Responses API with `store: false`. It can
incur provider charges. Use `aspect_ratio` of `1:1`, `3:2`, or `2:3` and `resolution`
of `1K` in the saved request. Shape guides composition; actual pixel dimensions
can differ. This backend accepts one image per request and rejects seed and step
controls. See [Meta's image API documentation](https://dev.meta.ai/docs/image-generation).

Each attempt gets a record in `images/` with generating, completed, or failed
status. Successful PNGs have checked chunk framing, checksums, bounded dimensions,
and a saved SHA-256 digest. Gallery records retain the prompt, model, actual
dimensions, and available token counts. Keys and raw provider errors are not
saved. A timeout may leave billing uncertain; there are no automatic retries or
provider fallbacks. Interrupted processes may leave a generating record for
manual inspection.

Add `--enhance` to `prepare` to have Muse Glimmer on Vultr write the prompt from
the selected story passages and art direction instead of the local template. It
needs `VULTR_INFERENCE_API_KEY`, makes one model call and records its token usage
and any invented visual choices as assumptions. Tests use synthetic PNGs
and mocked provider responses; they do not establish live account access or
image quality.

## Tiger accounts and shared studios

The optional Tiger/PostgreSQL backend adds accounts, revocable sessions, studio
memberships and invitations, shared projects, version history, and comments to
the studio API. Install `.[studio,tiger]` and follow [database setup](docs/TIGER.md)
for the explicit migration, restricted runtime role, verified TLS, and API routes.
Existing local projects remain file-backed; shared-account frontend integration
is separate work. No cloud database is created or migrated by application startup.

## Role guidance

Role prompts for the architect, writer and reviewers live in `skills/`:
`story_architect.md`, `design_review.md`, `distinct_writing.md`,
`story_quality.md`, `rhetoric_quality.md` and `memory_quality.md`. Interface
copy follows `.claude/skills/site-copy/SKILL.md`.
