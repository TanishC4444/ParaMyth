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

These modules are an initial foundation. A coordinator, retrieval, live inference, and a user interface are not included yet. Fixture output is synthetic test data, not generated fiction.
