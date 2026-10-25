# Account workspaces and public hosting

Use `paramyth.studio.app:create_app` for the hosted author workspace. Setting
`PARAMYTH_PUBLIC_ORIGIN=https://your-domain.tech` enables required sign-in and
account-owned storage. The same-origin frontend calls server APIs; the server
uses shared provider keys from its environment. A `.tech` suffix needs no special
provider code. Credentials, provider access, billing and any provider-side IP
restrictions still need to be configured on the actual host.

## Storage and returning users

- Tiger/PostgreSQL stores accounts, hashed passwords, expiring/revocable sessions,
  teams, memberships, invitations and team project revisions/comments.
- `PARAMYTH_WORKSPACE/users/<account UUID>/` stores each user's author projects,
  revisions, workspace drafts, notes, writing outputs, images, soundtracks,
  production plans, saved jobs and selected project. Signing out does not delete
  these files. Account IDs and project IDs remain stable when restoring a volume.
- Personal Calendar tokens are encrypted in each user's `.private` directory
  using `PARAMYTH_ENCRYPTION_KEY`. Server-owner Calendar access/refresh tokens are
  never inherited by users. Keep the encryption key across deploys and restores.
- Completed remote music is downloaded automatically. Pending submissions resume
  polling after a restart without submitting generation again. Failed downloads
  retain the provider job ID and retry; expired/unavailable provider audio cannot
  be recovered if it was never downloaded. Other interrupted generation jobs are
  marked interrupted, so users can inspect saved output before retrying.
- Browser recovery copies are namespaced by account. Server saves, rather than a
  browser cache, are the durable record. Wait for the save indicator before leaving.

Run **one application process/replica** against the workspace volume. Shared files
and job locking currently assume one process. Durable disk must survive restarts,
container replacements and deployments; ephemeral/serverless filesystem hosting
is unsuitable without a storage redesign. Back up Tiger, the workspace volume
and the encryption key together. Stop writes while taking/restoring a consistent
backup. Never run `docker compose down -v` on the deployment you want to retain.
Existing unowned local folders are not assigned to an arbitrary account: an owner
must explicitly choose which account should receive any imported local work.

## Server environment

Copy `.env.example` to `deploy/.env` (ignored by Git), or use the host's secret
manager. Set:

| Variable | Purpose |
| --- | --- |
| `PARAMYTH_DOMAIN` | Actual hostname, without scheme, for Compose/Caddy |
| `PARAMYTH_PUBLIC_ORIGIN` | Exact HTTPS origin on non-Compose hosts |
| `PARAMYTH_DATABASE_URL` | Restricted application-role Tiger URL; see [TIGER.md](TIGER.md) |
| `PARAMYTH_ENCRYPTION_KEY` | A persistent Fernet key, generated once |
| `PARAMYTH_WORKSPACE` | Persistent writable directory; Compose sets `/data` |
| `VULTR_INFERENCE_API_KEY` | Shared creative writing, music and planning provider |
| `MUSE_IMAGE_API_KEY` | Shared image provider (`MODEL_API_KEY` is also supported) |
| `GEMINI_API_KEY` | Shared semantic search/embeddings |
| `SERPAPI_API_KEY` | Optional web research |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional Calendar OAuth app credentials |

Generate the encryption key once in a private terminal:

```sh
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Account APIs need the migrations and role grants in [TIGER.md](TIGER.md).
Keep the migration-owner URL out of the running app environment. Do not enable
`PARAMYTH_DB_LOCAL_TEST` on the deployed server; Tiger uses certificate-verified TLS.
The requested temporary password rule remains 1–128 characters; passwords are
still salted and hashed. Sessions last seven days and logout revokes them.

Provider keys are only installed on the server. Hosted visitors can view service
availability but cannot set/replace global keys. GitHub workflow administration
is not exposed through this app. Do not expose the older
`paramyth.pipeline.api.app` or set `PARAMYTH_SERVICE_ORIGIN` as a substitute for
the direct shared provider integrations in a multi-user deployment.

For Google Calendar, register exactly
`https://your-domain.tech/google/callback` as the OAuth redirect URI and configure
the consent screen's domain/users for the intended audience. Each user connects
their own Calendar. The app keeps pending authorization states in memory; restart
the connection flow if the server restarts during authorization.

## Docker host with automatic HTTPS

From the repository root, after filling `deploy/.env`:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
```

Point the hostname's DNS at that server and allow ports 80 and 443. Caddy obtains
and renews certificates using [automatic HTTPS](https://caddyserver.com/docs/automatic-https).
Only Caddy publishes ports; the application is on a private Docker network.
Its fixed proxy address `172.30.0.2` is the only trusted forwarded-header sender,
following [Uvicorn proxy guidance](https://uvicorn.dev/deployment/). If the host
already uses subnet `172.30.0.0/24`, change the subnet/addresses and trusted proxy
address together. Never trust arbitrary forwarded headers from the public Internet.

The image runs as UID 10001. For a host bind mount instead of the supplied named
volume, give this UID write permission. The supplied Caddy config bounds request
bodies to 6 MB. On managed hosting, configure equivalent HTTPS, request limits,
trusted-proxy settings, a persistent volume and a single replica. Serve the
frontend and API from the same origin, including `/api`, `/media`, `/export`,
`/google` and `/studio`; do not deploy just the static frontend.

## Verification

`tests/test_account_workspaces.py` verifies real PostgreSQL sign-up/login, isolated
projects/media/jobs, logout/relogin, copied-volume restore, encrypted personal
Calendar tokens, automatic music archiving, host/origin/session guards and refusal
to change shared keys. It uses generated test accounts and removes only those.
Run with a migrated disposable database and `PARAMYTH_TEST_DATABASE_URL`:

```sh
python -m pip install -e '.[studio,tiger,api,rag,docx,hosted,test]'
python -m unittest discover -s tests -p test_account_workspaces.py -v
cd frontend
pnpm install --frozen-lockfile
pnpm build
pnpm exec tsc --noEmit
```

After deployment, verify account creation, signing out/in, a saved project after
server restart, and each configured provider from the real domain. Unit/integration
tests mock paid provider operations; they do not establish that a key has credit,
model access or production OAuth approval.
