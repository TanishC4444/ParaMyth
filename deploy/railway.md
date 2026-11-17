# Railway hosting

GitHub Actions deploys the public frontend to GitHub Pages at `paramyth.tech`.
Railway runs FastAPI, generation jobs and persistent workspaces. The `main`
branch is public and account-free: each browser gets a random guest ID stored
in its browser storage, and the backend keeps that guest's projects in an
isolated workspace. Visitors do not create accounts or sign in. Provider
credentials stay on the server. Account and team functionality lives on the
separate `studio-auth` branch.

Set the GitHub repository variable `PARAMYTH_API_BASE` to the Railway API
origin. The website workflow supplies it as the public `VITE_API_BASE` build
setting. The frontend sends its random guest ID on backend requests, so studio
access does not depend on third-party cookies.

Set Railway's `PARAMYTH_FRONTEND_ORIGIN` to `https://paramyth.tech` and
`PARAMYTH_PUBLIC_ORIGIN` to the backend's HTTPS origin. The backend permits
requests only from that exact frontend and redirects its own homepage to the
frontend.

The guest ID contains no personal information. It identifies the browser's
private workspace, so anyone who obtains that ID could access its saved work.
Treat it like a private link. Clearing this browser's site storage creates a
new workspace identity; old guest files remain on the persistent volume.

Configure the service with these variables:

| Variable | Value |
| --- | --- |
| `RAILWAY_DOCKERFILE_PATH` | `deploy/Dockerfile.api` |
| `PARAMYTH_WORKSPACE` | `/data` |
| `RAILWAY_RUN_UID` | `0` |
| `PORT` | `8000` |
| `PARAMYTH_ENCRYPTION_KEY` | Persistent Fernet key, retained across deployments |

Attach one persistent volume at `/data`. Railway mounts volumes as root; the
startup command prepares that mount and then drops to the image's `paramyth`
user before serving requests. Use one replica because projects and jobs share
one mounted volume and job manager. Set the healthcheck path to
`/api/v1/health`.

Account and team flows are maintained on `studio-auth`. PostgreSQL migrations
and `PARAMYTH_DATABASE_URL` are not required for the public guest-workspace
deployment.

Save provider credentials as Railway service variables: `GEMINI_API_KEY`,
`VULTR_PRODUCTION_API_KEY`, `VULTR_MUSIC_API_KEY`, `MUSE_IMAGE_API_KEY`, and
`SERPAPI_API_KEY`, as needed by the enabled services. Never put them in frontend
environment variables or commit a credentials file.

Generate a Railway domain targeting port 8000. Its `RAILWAY_PUBLIC_DOMAIN`
provides the public API origin for guest workspaces. For a backend custom
domain, add the domain in Railway, configure the DNS records Railway supplies,
and set `PARAMYTH_PUBLIC_ORIGIN` to that exact HTTPS origin. The application
rejects other hostnames, apart from Railway's healthcheck endpoint. Confirm the
new domain is ready before switching the canonical origin.

Local owner-managed credentials can instead live in a file outside the checkout
selected by `PARAMYTH_ENV_FILE`. Existing platform variables take precedence.
Do not set that variable on Railway unless the referenced file exists there.

Deployment checks: `/api/v1/health` returns `ok`, `/api/ui/public-config`
reports `accounts_required: false`, an account-free browser session can load
`/api/ui/workspace` and create a project, and a second guest ID sees a separate
workspace. Confirm generation and restoration with configured live providers.
