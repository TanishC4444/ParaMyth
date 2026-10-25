# ParaMyth

Early backend foundations for a file-backed storytelling workflow.

## Included

- Validated story requests, scene plans, reviews, and memory updates.
- Atomic JSON writes and a single-writer lock for run folders.
- Deterministic fixtures for testing coordination without model calls.

## Run checks

Requires Python 3.11 or newer. No third-party dependencies, credentials, or network calls are needed for these tests.

```sh
python -m unittest discover -s tests -v
```

The backend-tests workflow checks contracts and storage on Python 3.11 and 3.12. The fixture-checks workflow checks fixture responses against the contracts.

The sequential coordinator supports plan approval, bounded retries, character-scoped memory, atomic scene acceptance, checkpoints, chapter export, and resumable runs. Retrieval and role transports can be injected. An explicit HTTPS chat-completions adapter is available. A user interface is not included. Fixture output is synthetic test data, not generated fiction.

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
checkpoint; resuming does not silently change its sources. This is FTS5 keyword
retrieval, not semantic/hybrid ranking or a retrieval-quality benchmark.

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

## Role guidance

Role prompts for the architect, writer and reviewers live in `skills/`:
`story_architect.md`, `design_review.md`, `distinct_writing.md`,
`story_quality.md`, `rhetoric_quality.md` and `memory_quality.md`. Interface
copy follows `.claude/skills/site-copy/SKILL.md`.
