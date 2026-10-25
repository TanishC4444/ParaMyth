# Accounts and studio teams

The team screen is `web/teams.html`, linked from the Story studio and API console.
It adds email/password accounts and studio collaboration to the existing FastAPI
application. Accounts, hashed passwords, revocable sessions, memberships,
invitations, project briefs, manuscripts, revisions and comments live in PostgreSQL
(including Tiger Cloud). These are regular relational tables in the `paramyth`
schema; Timescale hypertables are unnecessary for account data.

## Local setup

Use Python 3.11+ from the repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -e '.[api,studio,tiger]'
# Supply this through your local secret manager or server environment.
# Never put a real password in a committed file or in frontend-pipeline configuration.
$env:PARAMYTH_DATABASE_URL = 'postgresql://paramyth_app:PASSWORD@HOST:PORT/tsdb?sslmode=verify-full'
.\.venv\Scripts\python -m scripts.run_studio
```

To use the merged ParaMyth React frontend-pipeline, first run `pnpm install --frozen-lockfile`
and `pnpm build` from `frontend-pipeline/`. The local launcher serves it at
`http://127.0.0.1:8767/`, with a **Studio accounts & teams** link to the account screen.

The account screen also opens directly at `http://127.0.0.1:8767/studio/teams.html`. The API and UI run together, bound
only to localhost. No public hosting is required. Tiger Cloud still needs an
internet connection and incurs its normal database costs. Other computers cannot
connect to this localhost-only server. For local multi-user testing, use separate
browser tabs and sign in with different accounts.

Create an account, create a studio, and invite another account by email. Copy the
invitation link and share it privately. The recipient signs in with the invited
email and chooses **Join studio**. Invitations expire in seven days, can be revoked,
and work once. Reissuing an invitation replaces earlier unclaimed invitations for
that studio/email. No email delivery service is configured, so email verification
and forgotten-password email recovery are not provided. Knowing an email alone
does not allow joining: the recipient also needs the secret invitation link.

Sessions last seven days and are kept only in browser memory; reloading requires
sign-in. Sign-out revokes the session; changing a password revokes all sessions.

## Provisioning a database

For a **new** database, run the additive migration once with a migration-owner
connection (or execute `paramyth/studio/migrations/001_studios.sql` in Tiger):

```powershell
# Set PARAMYTH_MIGRATION_DATABASE_URL via your secret manager for this command.
python -m paramyth.studio.studio_db
```

Provision a dedicated LOGIN role using your database's secure password tooling,
then grant only the application's table permissions:

```sql
GRANT CONNECT ON DATABASE tsdb TO paramyth_app;
GRANT USAGE ON SCHEMA paramyth TO paramyth_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  paramyth.users, paramyth.sessions, paramyth.auth_limits,
  paramyth.studios, paramyth.memberships, paramyth.invitations,
  paramyth.projects, paramyth.project_revisions, paramyth.comments
TO paramyth_app;
```

The web process uses this restricted role, not `tsdbadmin`. The runtime role
cannot migrate schemas or manage database roles. Keep its password in the server
environment. Migrations are explicit; importing or starting the app never runs
DDL. The migration is transactional and repeatable. Future schema changes should
use new numbered migrations rather than modifying an already-applied migration.

TLS verifies the server hostname and certificate using Certifi roots. Set
`PARAMYTH_DB_CA_FILE` for a custom trusted CA. Only loopback integration tests may
use `PARAMYTH_DB_LOCAL_TEST=1` to connect to a local PostgreSQL without TLS.

## Permissions and shared editing

| Role | Read projects/history | Edit/comment | Invite | Rename studio | Manage roles/remove members |
|---|---|---|---|---|---|
| Owner | Yes | Yes | All roles | Yes | Yes |
| Admin | Yes | Yes | Editors/viewers | Yes | No |
| Editor | Yes | Yes | No | No | No |
| Viewer | Yes | No | No | No | No |

The studio has one permanent owner. Member-management endpoints cannot remove or
demote that owner. Access is checked against current membership on every request,
including revision and comment reads. Membership changes and project writes lock
the studio row to avoid authorization races. Users removed from a studio lose
access immediately on their next request; removing/demoting an inviter also stops
their outstanding invitations from granting access.

Project saves include the last loaded `version`. A stale save returns HTTP 409,
keeps the browser draft, and asks the writer to download/copy it before loading
and merging the latest revision. Every successful save records the prior and new
versions in revision history. This is shared save-based editing, not live cursor
or simultaneous character-by-character synchronization. Project lists and team
lists refresh on demand; the latest 100 revisions/comments are shown.

The existing GitHub Actions run API still uses the caller's GitHub token. Account
sessions do not grant GitHub permissions and are never exchanged for a shared
repository credential. Generated story text can be pasted into a shared project's
manuscript. Automatic association of workflow runs with teams is not implemented.

## API

Studio routes require `Authorization: Bearer pm_...`, returned by sign-up/login.
Full request/response contracts are available at `/docs` and in `web/openapi.json`.

- `POST /api/v1/accounts/signup`, `POST /api/v1/accounts/login`
- `GET /api/v1/accounts/me`, `POST /api/v1/accounts/logout`
- `POST /api/v1/accounts/password`
- `GET/POST /api/v1/studios`, `PATCH /api/v1/studios/{id}`
- `GET /api/v1/studios/{id}/members`, `PATCH/DELETE .../members/{user_id}`
- `GET/POST /api/v1/studios/{id}/invitations`, `DELETE .../invitations/{invite_id}`
- `POST /api/v1/invitations/accept`
- `GET/POST /api/v1/studios/{id}/projects`, `GET/PUT .../projects/{project_id}`
- `GET .../projects/{project_id}/revisions`, `GET .../revisions/{version}`
- `GET/POST .../projects/{project_id}/comments`

Passwords use salted scrypt; session and invitation tokens are stored as SHA-256
digests. Login/signup throttles persist across processes in PostgreSQL. Account
validation errors omit submitted values, private responses use `Cache-Control:
no-store`, and request bodies are bounded. SQL always binds submitted values.
The API is the authorization boundary; its database credentials are server-only.
Never distribute the database connection to studio members.

## Verification

```powershell
python -m pip install -e '.[api,studio,test]'
# Opt-in DEV/test database, already migrated, using the restricted app role:
$env:PARAMYTH_TEST_DATABASE_URL = $env:PARAMYTH_DATABASE_URL
python -m unittest discover -s tests -p test_studios.py -v
python -m unittest discover -s tests -p test_api.py -v
```

Integration tests create unique accounts under `example.invalid`, then remove
only their own users/studios. They check cross-studio isolation, roles, invitation
expiry/replay/revocation, session invalidation, password hashing, concurrent-save
conflicts and revision history against real PostgreSQL. The dedicated CI job uses
an ephemeral PostgreSQL service, with no access to cloud credentials.

For public deployment later, run the API behind HTTPS, configure allowed frontend-pipeline
origins with `PARAMYTH_CORS_ORIGINS`, and configure trusted proxy addresses before
using forwarded client IPs for rate limits. GitHub Pages hosts only the static UI;
it cannot host this backend or hold database secrets.
