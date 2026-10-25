# Tiger database backend

ParaMyth can store accounts and shared studios in Tiger Cloud or another
PostgreSQL service. The backend uses ordinary relational tables in the `paramyth`
schema. It does not need Timescale hypertables or provision a cloud service.

## Configure and migrate

Install the API and database dependencies:

```sh
python -m pip install '.[studio,tiger]'
```

Supply `PARAMYTH_MIGRATION_DATABASE_URL` through the process environment using a
database owner connection, then run the explicit migration:

```sh
python -m paramyth.studio.studio_db
```

The migration is transactional, repeatable, and guarded by a database advisory
lock. Application startup never runs migrations. Keep the migration credential
out of the web process after setup. Future schema changes should use new numbered
migrations rather than editing a migration already applied to a database.

Create a separate login role with your database's password-management tooling.
For a role named `paramyth_app`, grant only the application permissions below
(also grant CONNECT on your database if it is not already allowed):

```sql
GRANT USAGE ON SCHEMA paramyth TO paramyth_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  paramyth.users, paramyth.sessions, paramyth.auth_limits,
  paramyth.studios, paramyth.memberships, paramyth.invitations,
  paramyth.projects, paramyth.project_revisions, paramyth.comments
TO paramyth_app;
```

Set `PARAMYTH_DATABASE_URL` to this restricted role's connection string and start
the existing studio server:

```sh
python -m paramyth.studio.serve
```

URLs are read from the process environment, not automatically from `.env`.
Never put credentials in frontend configuration or committed files. Connections
force `sslmode=verify-full` with Certifi roots; `PARAMYTH_DB_CA_FILE` can select a
trusted CA bundle for your server. For disposable loopback tests only,
`PARAMYTH_DB_LOCAL_TEST=1` permits a local connection without TLS. Remote hosts
still require certificate verification even if that test flag is set.

## Account and collaboration API

The API is available in the existing server's `/docs`. Sign-up and login return
an opaque `pm_` session token; other account routes take it in an
`Authorization: Bearer ...` header. Session tokens are distinct from the local
workspace's request token and any provider API keys.

- `POST /api/v1/accounts/signup` and `/api/v1/accounts/login`
- `GET /api/v1/accounts/me`, `POST /api/v1/accounts/logout` and `/api/v1/accounts/password`
- `GET/POST /api/v1/studios`, `PATCH /api/v1/studios/{id}`
- `GET /api/v1/studios/{id}/members`, `PATCH/DELETE .../members/{user_id}`
- `GET/POST /api/v1/studios/{id}/invitations`, `DELETE .../invitations/{invitation_id}`
- `POST /api/v1/invitations/accept`
- `GET/POST /api/v1/studios/{id}/projects`, `GET/PUT .../projects/{project_id}`
- `GET .../projects/{project_id}/revisions` and `.../revisions/{version}`
- `GET/POST .../projects/{project_id}/comments`

The permanent owner manages member roles. Administrators can rename the studio
and invite editors/viewers. Editors can save projects and add comments. Viewers
can read projects, comments, and revisions. Nonmembers cannot access the studio.
Revoked membership and demoted inviters are checked on subsequent requests.

Project updates include the last loaded `version`. Concurrent stale saves return
409, and successful saves preserve revision history. This is versioned shared
editing, not simultaneous character-by-character collaboration.

Passwords use salted scrypt. Session and invitation tokens are stored as digests.
Sessions and invitations expire after seven days; changing a password revokes all
sessions. Invitations are single-use and restricted to the invited account's
email. Invitations must be shared manually: email delivery, email verification,
and forgotten-password recovery are not implemented.

Account responses cannot be cached, validation errors omit submitted inputs, and
request bodies are limited to 5 MiB. Authentication throttles persist in the
database. SQL parameters are bound, connection errors are redacted, and database
transactions finish before a successful response is sent.

The existing local workspace remains file-backed and local-only. These endpoints
add separate shared-project storage; they do not upload existing run folders or
change the frontend's local project workflow. A shared-account frontend is future
work. The studio launcher still binds to loopback.

## Verification

The Tiger CI workflow starts disposable PostgreSQL, runs the migration twice,
then tests with a restricted application role. It covers account sessions,
invitation replay and expiry, role isolation, concurrent edits, history,
password revocation, persisted throttles, and denied schema creation.

For an already migrated disposable database, set `PARAMYTH_TEST_DATABASE_URL`
to a restricted role and run:

```sh
python -X utf8 -m unittest discover -s tests -p test_studios.py -v
python -X utf8 -m unittest discover -s tests -p test_tiger_db.py -v
```

Database integration tests skip when the test URL is absent. Never point these
tests at production; they create and remove generated test accounts and studios.

## Upgrading a Storyforge database

ParaMyth uses the `paramyth` schema and `PARAMYTH_DATABASE_URL`; the old
`STORYFORGE_DATABASE_URL` variable and `storyforge` tables are not used by the
new server. A database containing only the old tables will return HTTP 503 on
signup and login until it is migrated and the runtime role has access.

Stop legacy account/team writers during the cutover. With the owner connection
in `PARAMYTH_MIGRATION_DATABASE_URL`, run:

```sh
python -m paramyth.studio.studio_db --import-storyforge
```

This explicit, transactional import creates the new schema and copies accounts,
password hashes, studios, memberships, invitations, projects, revisions, comments
and authentication throttles. It verifies each copied table before recording
migration 2. The destination must be empty; conflicting data causes a rollback
instead of silently merging users or overwriting passwords. Repeating a completed
import does nothing. Legacy sessions are not imported because their token prefix
differs; sign in again with the existing password.

The legacy schema remains intact. If the migration fails, the transaction rolls
back automatically. Before the new app accepts writes, rollback means continuing
to run the old app against its untouched schema. After new writes, reconcile
those changes before reverting; the two schemas are not synchronized. Do not
continue using the legacy account server after the cutover.

Grant the new schema/table permissions documented above to the actual runtime
role. Reusing an existing restricted role (for example `storyforge_app`) is fine;
substitute its name in those grants. Set `PARAMYTH_DATABASE_URL` to that role's
connection string in the server process, install `.[studio,tiger]`, and restart
the new server. Do not put the owner connection or credentials in the frontend.

The account page is `/studio/teams.html?mode=signup`, served by both API entry
points when running from the repository, with or without a frontend build. Its
form submits to `/api/v1/accounts/signup` on the same origin. A name, valid email,
and a 12–128 character password are required. Existing email addresses return
409 and switch the form to sign-in. Password recovery is still not implemented.

The legacy migration tests require an **empty disposable database** and an owner
connection in `PARAMYTH_MIGRATION_TEST_DATABASE_URL`. Each test rolls back its
fixture schemas. Run `python -m unittest discover -s tests -p test_legacy_migration.py -v`.
