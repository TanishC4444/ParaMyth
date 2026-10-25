# Railway hosting

Deploy the frontend and FastAPI studio as one service from the repository root.
The Docker build compiles the existing frontend and serves it from the same
origin as the API. Visitors sign in or create an account; provider credentials
stay on the server.

Configure the service with these variables:

| Variable | Value |
| --- | --- |
| `RAILWAY_DOCKERFILE_PATH` | `deploy/Dockerfile` |
| `PARAMYTH_WORKSPACE` | `/data` |
| `RAILWAY_RUN_UID` | `0` |
| `PORT` | `8000` |
| `PARAMYTH_DATABASE_URL` | Restricted Tiger application connection, with TLS |
| `PARAMYTH_ENCRYPTION_KEY` | Persistent Fernet key, retained across deployments |

Attach one persistent volume at `/data`. Railway mounts volumes as root; the
startup command prepares that mount and then drops to the image's `paramyth`
user before serving requests. Use one replica because project files and jobs
are managed by one process. Set the healthcheck path to `/api/v1/health`.

Save provider credentials as Railway service variables: `GEMINI_API_KEY`,
`VULTR_PRODUCTION_API_KEY`, `VULTR_MUSIC_API_KEY`, `MUSE_IMAGE_API_KEY`, and
`SERPAPI_API_KEY`, as needed by the enabled services. Never put them in frontend
environment variables or commit a credentials file. Apply database migrations
separately with the migration role; the running app uses the restricted role.

Generate a Railway domain targeting port 8000. Its `RAILWAY_PUBLIC_DOMAIN`
automatically enables hosted account isolation. For a custom domain, add the
domain in Railway, configure the DNS records Railway supplies, and set
`PARAMYTH_PUBLIC_ORIGIN` to that exact HTTPS origin. The application rejects
other hostnames, apart from Railway's healthcheck endpoint. Confirm the new
domain is ready before switching the canonical origin.

Local owner-managed credentials can instead live in a file outside the checkout
selected by `PARAMYTH_ENV_FILE`. Existing platform variables take precedence.
Do not set that variable on Railway unless the referenced file exists there.

Deployment checks: `/api/v1/health` returns `ok`, `/api/ui/public-config` reports
account workspaces, the homepage offers Sign in and Create account, and an
anonymous request to `/api/ui/workspace` is rejected. After signing in, confirm
project creation, generation and restoration with the configured live providers.
