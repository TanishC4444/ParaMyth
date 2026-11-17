"""Same-origin hosting guards; public access never disables account isolation."""
from urllib.parse import urlsplit
import os
import ipaddress

from fastapi import HTTPException, Request
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from . import accounts
from .studio_http import studio_path

PUBLIC_APIS = {'/api/v1/health', '/api/ui/public-config', '/api/v1/accounts/signup', '/api/v1/accounts/login'}


def guest_identity(request: Request):
    """Validate the random browser identifier used for account-free workspace isolation."""
    from uuid import UUID
    value = request.headers.get('X-ParaMyth-Guest', '')
    # Native media elements and EventSource cannot set custom headers. Permit
    # the same per-browser capability in query strings for read-only requests.
    if (not value and request.method in ('GET', 'HEAD')
            and (request.url.path.startswith(('/media/', '/export/'))
                 or (request.url.path.startswith('/api/ui/creative/jobs/')
                     and request.url.path.endswith('/events')))):
        value = request.query_params.get('guest_id', '')
    if (not value and request.url.path == '/google/callback'
            and getattr(request.app.state, 'public_workspaces', False)):
        value = request.app.state.workspaces.guest_oauth.get(request.query_params.get('state', ''), '')
    try:
        return str(UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(401, 'Open the studio to start an anonymous workspace') from None


def validate_origin(value):
    value = value.rstrip('/')
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.path or parsed.query or parsed.fragment):
        raise ValueError('PARAMYTH_PUBLIC_ORIGIN must be one HTTPS origin, such as https://your-domain.tech')
    return value


class HostedRequests(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        public = getattr(request.app.state, 'public_origin', '')
        railway = bool(os.getenv('RAILWAY_PROJECT_ID'))
        health_probe = railway and request.method in ('GET', 'HEAD') and request.url.path == '/api/v1/health' and request.url.hostname == 'healthcheck.railway.app'
        if public and request.url.netloc.lower() != urlsplit(public).netloc.lower() and not health_probe:
            return JSONResponse({'detail': 'Host rejected'}, status_code=400)
        if railway and request.headers.get('x-real-ip'):
            try:
                address = str(ipaddress.ip_address(request.headers['x-real-ip']))
                request.scope['client'] = (address, request.client.port if request.client else 0)
            except ValueError:
                return JSONResponse({'detail': 'Client address rejected'}, status_code=400)
        path = request.url.path
        private = request.method != 'OPTIONS' and path.startswith(('/api/', '/media/', '/export/', '/google/')) and path not in PUBLIC_APIS
        try:
            if request.method not in ('GET', 'HEAD', 'OPTIONS'):
                accounts.same_origin(request)
            if private:
                if getattr(request.app.state, 'account_workspaces', False):
                    account = await run_in_threadpool(accounts.user, request)
                    expected = request.headers.get('X-ParaMyth-Account')
                    if expected and expected != str(account['id']):
                        raise HTTPException(409, 'Your account changed. Reload this page before continuing.')
                    if not studio_path(path):
                        from .team_workspace import authorize_workspace
                        request.state.studio = await run_in_threadpool(authorize_workspace, request, account)
                    if request.method not in ('GET', 'HEAD', 'OPTIONS') and not studio_path(path):
                        accounts.require_csrf(request)
                elif getattr(request.app.state, 'public_workspaces', False):
                    request.state.guest_id = guest_identity(request)
                    if request.method not in ('GET', 'HEAD'):
                        runtime = request.app.state.workspaces.get_guest(request.state.guest_id)
                        accounts.same_origin(request)
                        if request.headers.get('X-ParaMyth-Token') != runtime.token:
                            raise HTTPException(403, 'Refresh this page before saving changes')
            if path == '/api/ui/retrieval-connection' and request.method == 'POST':
                raise HTTPException(403, 'Shared service keys are managed by the server owner')
            response = await call_next(request)
        except HTTPException as exc:
            response = JSONResponse({'detail': exc.detail}, status_code=exc.status_code, headers=exc.headers)
        if path.startswith(('/api/', '/media/', '/export/', '/google/')):
            response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'same-origin'
        response.headers['X-Frame-Options'] = 'DENY'
        if public:
            response.headers['Strict-Transport-Security'] = 'max-age=31536000'
        return response
