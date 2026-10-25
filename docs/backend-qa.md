# Backend QA — October 25, 2026

Final local result: **799 backend tests passed, zero failures and zero skips**.
The last full run took 93.389 seconds on Python 3.12.14. These results cover
automated contracts and local integration behavior; they do not establish live
provider access or production deployment health.

## Verification

| Check | Result |
| --- | --- |
| Complete Python unittest discovery | 799 passed; no skips |
| PostgreSQL account/team tests | Ran against disposable PostgreSQL 18 with a restricted application role |
| Migrations | Base migration ran twice; all four legacy migration tests passed against an empty disposable database |
| Frontend API, media, account and team transport contracts | 31 passed |
| Legacy account-page behavior | 2 passed |
| Frontend TypeScript and production build | Passed; existing bundle-size advisory remains |
| Strict copy lint and Git whitespace check | Passed |
| API deployment image | Built successfully |
| Real HTTP container smoke test | Passed signup, team creation, invitation acceptance, project creation, access restrictions, lexical search and Atlas |
| Container restart | Shared project, manuscript, team membership and sessions survived restart |

Statement coverage was 86% across the backend and approximately 92% for
`paramyth/studio/`. Coverage is a measure of executed statements, not a guarantee
that every possible input or external-service behavior works.

## Workflows exercised

- Account signup, login/logout, password changes, expired/revoked sessions,
  persistent throttling, validation redaction, CSRF, host checks and split-origin CORS.
- Team creation and renaming; owner/admin/editor/viewer permissions; outsider
  isolation; invitation email matching, expiry, revocation, replay and demoted inviters.
- Every workspace mutation exposed in the hosted OpenAPI schema rejects viewers
  and outsiders, with project selection tested separately as an allowed viewer action.
- Personal and shared author projects, shared copies, draft conflicts, revision
  history, comments, removed members, account-specific selection and volume restoration.
- Creative drafting/review/revision, partial streams, interrupted jobs, creative
  adoption, literary keyword/semantic retrieval contracts and Atlas mapping.
- Meta image requests and validation, story-aware prompts, shared generated images,
  Vultr soundtrack contracts, local WAV output, music archiving and failed downloads.
- Production schedules, budgets, research evidence, constraints, selected media,
  Calendar OAuth/sync contracts, and ICS/CSV/call-sheet/JSON exports.
- Provider error handling, credential selection, response bounds and redirect refusal.

Paid provider responses and Calendar exchanges were mocked. The deployment-image
smoke test used actual HTTP requests and PostgreSQL without mocking the application.

## Fixes made during QA

- Resolve project paths consistently so macOS aliases and symbolic links do not
  break project lookup or creative-result adoption.
- Reject missing/non-string project selections before modifying saved preferences.
- Validate notes and pins before saving, preserving existing valid notes when a
  malformed request is rejected; ignore malformed legacy pin entries during export.
- Return HTTP 404 for missing production plans across reads, exports, recalculation
  and Calendar sync, rather than HTTP 500.
- Reject malformed production configuration and writing-source selections with
  validation errors; validate music duration, prompt and lyrics before queuing jobs.
- Honor `VULTR_PRODUCTION_API_KEY` in the standalone planner.
- Disable redirects for streaming creative and music provider requests; bound and
  validate music JSON responses and handle transport failures without exposing credentials.
- Keep explicitly local ambience independent of remote music-model discovery.

`tests/test_backend_final_qa.py` contains the new regression and hosted permission
checks. The Tiger CI workflow now runs it with a real PostgreSQL test database.
Existing creative-stream mocks were updated for the protected transport; the
soundtrack-discovery test now compares canonical temporary paths on macOS.

## Reproduce

Install `.[test,api,rag,tiger,production,studio,hosted]` in a Python environment.
Following `docs/TIGER.md`, prepare a disposable migrated database and a restricted
application role. Use a separate empty database for legacy migration tests.
Never point these tests at production.

```sh
export PARAMYTH_TEST_DATABASE_URL='<disposable restricted-role PostgreSQL URL>'
export PARAMYTH_MIGRATION_TEST_DATABASE_URL='<separate empty disposable owner URL>'
# Only for a disposable database listening on loopback:
export PARAMYTH_DB_LOCAL_TEST=1
python -m unittest discover -s tests -v
python -m scripts.copy_lint --strict
node --test tests/advanced_account_ui.cjs
cd frontend
node --test tests/*.test.cjs
pnpm exec tsc --noEmit
pnpm build
```

Detailed logs and coverage data from this session are in
`/tmp/paramyth-final-qa/`, including `backend-verified.log`, `coverage.json`,
`frontend-contracts.log`, `docker-build-final.log` and `container-smoke.log`.

## Remaining live verification

No Vultr, Meta, Gemini, production Tiger, Google OAuth or GitHub workflow
credentials were available in this workspace. Real account credits, model
availability, output quality, remote TLS connectivity, production OAuth consent
and workflow execution therefore remain unverified. The disposable PostgreSQL
checks verify the Tiger-compatible database integration, not a live Tiger service.
No deployment, production data migration, production writes or external
messages were performed. Changes remain local for review.
