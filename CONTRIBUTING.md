# Contributing to ParaMyth

Start with the [architecture](docs/ARCHITECTURE.md). The interactive studio and
advanced runner engine share components but have distinct orchestration paths.
Describe which surface a change affects and keep source/provisional/canon labels
accurate.

## Local checks

From a Python 3.11+ virtual environment at the repository root:

```sh
python -m pip install -e ".[test,api,rag,tiger,production,studio,hosted]"
python -m unittest discover -s tests -v
python -m scripts.copy_lint --strict
```

Database tests skip unless disposable test database URLs are configured. Follow
[the Tiger guide](docs/TIGER.md); the Tiger workflow provisions its own service
and restricted application role. A skipped database test is not a passed test.

For the main frontend, use Node.js 22.12+ or 24:

```sh
cd frontend
pnpm install --frozen-lockfile
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

The advanced workspace uses its own package and tests in `frontend-pipeline/`.
Never run live generation or publish a site merely to validate a documentation
change. Provider integration tests should use fixtures unless a live check is
explicitly intended.

## Changes that need extra care

- **Retrieval:** changing `document_text` invalidates stored vectors. Rebuild using
  `python -m paramyth.rag.ingest --corpus data/literary-corpus.json`; do not stamp a
  new identity onto incompatible embeddings. The bundled-index regression checks
  the committed artifact's fingerprint and projections without network access.
- **Agents and memory:** source hashes, passage ownership, knowledge visibility,
  and acceptance gates must survive retries and repairs. Include a failure case
  showing rejected output leaves accepted state unchanged.
- **Research:** malformed paid-provider responses must not poison the cache or
  trigger blind key sweeps. Preserve source identity, timestamps, units, currencies,
  and the distinction between estimates and verified prices.
- **Collaboration:** authorization belongs on the server. Include viewer/outsider
  rejection and stale-revision behavior for mutation changes.
- **Saved work:** preserve partial drafts and job diagnostics. Do not turn missing
  usage into zero, interrupted work into success, or fixtures into live results.

Keep pull requests focused. Explain the user-visible failure, resulting behavior,
checks actually run, and relevant skipped/live checks. New measurements should
include their workload and environment; do not infer speed or quality improvements
from implementation counts.
