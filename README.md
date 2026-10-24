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

The sequential coordinator supports plan approval, bounded retries, character-scoped memory, atomic scene acceptance, checkpoints, chapter export, and resumable runs. Retrieval and role transports can be injected. Live inference and a user interface are not included. Fixture output is synthetic test data, not generated fiction.

## Start and resume

```sh
python -m paramyth.cli --request example.json --out runs/harbor
python -m paramyth.cli --out runs/harbor --resume --approve-plan --stop-after 2
python -m paramyth.cli --out runs/harbor --resume
```

Review `plan.json` before approving it. Rejected drafts stay under `work/`; accepted scenes and memory are committed together in `state.json`. Changing a request requires a new run folder. Completed runs can be resumed without repeating accepted work.
