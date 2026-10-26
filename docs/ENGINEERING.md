# Engineering evidence

[Overview](../README.md) · [Architecture](ARCHITECTURE.md) · [Contributing](../CONTRIBUTING.md)

This page separates implementation scope, local verification, and outcomes that
have not been measured. Repository counts are not adoption or performance metrics.

## Claims you can trace to code

| Claim | Evidence | Meaning and limit |
| --- | --- | --- |
| 605 indexed records; 603 retrieval-enabled | `data/literary_rag.db`, `rag_documents` | Corpus size, not users or generated stories |
| 768 dimensions per stored embedding | Same table, `embedding`; [encoder](../paramyth/rag/embeddings.py) | All 605 vectors have this shape; document/query tasks are distinct |
| Cosine + FTS5/BM25 + weighted rank fusion | [Search](../paramyth/rag/db.py), [advanced facets](../paramyth/pipeline/retrieval.py) | Implemented ranking; no recall/precision benchmark claimed |
| Four research engines | [SerpAPI adapter](../paramyth/production_research.py) | Google Search, Maps, Hotels, Flights |
| 6-hour legal and 24-hour other cache expiry | Same adapter | Configured retention, not a measured API-call reduction |
| Transactional rolling quota and key cooldowns | `Search.reserve`, `Search.search` | SQLite `BEGIN IMMEDIATE`; 24-hour attempt window; one-hour cooldown; at most three keys considered |
| 18 departments and at most 40 operations tasks | [Operations](../paramyth/pipeline/production_operations.py) | Planner scope and validation caps, not completed real shoots |
| Dependency-aware scheduling and decimal budgets | [Scheduler and budget](../paramyth/pipeline/production.py) | Single-unit heuristic, `Decimal` arithmetic, explicit unknown costs |
| Four collaboration roles | [Studios](../paramyth/studio/studios.py), [workspace authorization](../paramyth/studio/team_workspace.py) | Owner, admin, editor, viewer; server-side enforcement |
| Paragraph IDs, offsets, and SHA-256 evidence | [Evidence](../paramyth/pipeline/evidence.py), [patching](../paramyth/pipeline/patching.py) | Binds text identity/version, not factual truth |
| Append-only canon and private character knowledge | [Canon](../paramyth/pipeline/canon.py), [actor packets](../paramyth/pipeline/dag.py) | Explicit supersession, visibility filtering, accepted-state transitions |
| Parallel role stages on independent runners | [Story workflow](../.github/workflows/story.yml) | Actual overlap depends on account concurrency and runner availability |
| Conflict-aware shared edits | [Workspace API](../paramyth/pipeline/api/ui_workspace.py) | Revision hashes and HTTP 409; no CRDT/OT claim |
| Source-aware image/music/production handoff | [Media workspace](../paramyth/pipeline/media_workspace.py) | Persisted writing signatures identify selected source snapshots |

## Local verification: October 26, 2026

Environment: macOS ARM64, Python 3.12.14; isolated virtual environment with the
`test,api,rag,tiger,production,studio,hosted` extras. The frontend lockfile was
installed with pnpm 11.25.0. Provider tests use fixtures/mocks; no paid generation
or production database operation was needed.

| Check | Observed result |
| --- | --- |
| Backend before changes | 835 discovered; 800 passed; 35 skipped; zero failures |
| Backend after changes | 837 discovered; 802 passed; 35 skipped; zero failures; 54.132 seconds |
| PostgreSQL integration | 35 tests skipped: no disposable database configured locally |
| Main frontend tests | 47 passed; zero failures/skips |
| Main frontend TypeScript | Passed |
| Main frontend production build | Passed; Three.js chunk-size advisory remains |
| Bundled index reconciliation | 605 documents; zero re-embeddings; no provider call |
| New malformed-response regression | 13 malformed Maps/Hotels/Flights shapes; each rejected without cache insertion or key failover |

These results describe this local run, not current remote CI or production
uptime. [Earlier database QA](backend-qa.md) is a separate historical run with a
disposable PostgreSQL service; its counts should not be mixed with this run.

### Reproduce the corpus counts without provider credentials

Run at the repository root:

```sh
python - <<'PY'
import json
import sqlite3
from pathlib import Path

path = Path('data/literary_rag.db').resolve()
with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as conn:
    print('total, enabled:', conn.execute(
        'SELECT count(*),sum(enabled) FROM rag_documents').fetchone())
    dimensions = {len(json.loads(v)) for (v,) in conn.execute(
        'SELECT embedding FROM rag_documents')}
    print('dimensions:', sorted(dimensions))
    print('metadata:', dict(conn.execute('SELECT key,value FROM rag_metadata')))
PY
```

The artifact-level test `test_bundled_index_is_searchable_without_provider_credentials`
also checks source projections, the corpus fingerprint, and a real lexical query
against the committed database. It fails if a provider embedding call is attempted.

## Failures repaired in this update

**Fresh-clone search:** the bundled database had all current vectors and matching
projections but lacked `rag_metadata`. The main studio correctly rejected it as
incomplete, so an otherwise valid checkout could not run keyword search. Ingestion
reconciled the existing index and published its completion metadata with zero
re-embeddings. A regression now exercises the bundled artifact directly.

**Structured research responses:** Maps, Hotels, and Flights accepted malformed
containers/nested fields until Python raised `TypeError` or `AttributeError`.
These are now validated as provider failures before cache insertion. Failures do
not trigger extra paid backup-key requests. The adapter remains shared by the
standalone and advanced planners.

**Verification coverage:** the backend matrix previously ran only contract and
storage suites. It now installs the full dependency extras and discovers the
complete backend suite on Python 3.11/3.12, including production and research
regressions. PostgreSQL remains a separate service-backed workflow. The main
frontend exposes one `pnpm test` command, used by the website build workflow.

## Measurements deliberately not claimed

There is no verified user count, production request throughput, latency/cost
reduction, retrieval accuracy, or controlled quality improvement in this review.
The matched continuity demos have a defined comparison protocol, but three short
scenarios do not establish general long-story superiority. Current tests do not
verify paid-account access, deployed TLS/uptime, model prose quality, travel
availability, or Calendar consent. Those need separate live measurements.
