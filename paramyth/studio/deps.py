"""Request guards shared by studio routes: local access, write token and current project."""
from fastapi import Depends, HTTPException, Request

from .runtime import Runtime

LOCAL_HOSTS = ('127.0.0.1', 'localhost', '::1', 'testserver')
LOCAL_CLIENTS = ('127.0.0.1', '::1', 'testclient')
TOKEN_HEADER = 'X-ParaMyth-Token'
PROJECT_COOKIE = 'paramyth_project'


def get_runtime(request: Request) -> Runtime:
    return request.app.state.runtime


def local(request: Request):
    if request.url.hostname not in LOCAL_HOSTS or (request.client and request.client.host not in LOCAL_CLIENTS):
        raise HTTPException(403, 'The studio is a local workspace. Start it on 127.0.0.1 and open it on this machine.')


def write(request: Request, runtime: Runtime = Depends(get_runtime)):
    """Changes need the page's token and, when a browser sends one, a same-origin Origin."""
    local(request)
    if request.headers.get(TOKEN_HEADER) != runtime.token:
        raise HTTPException(403, 'Refresh this page to get its local request token')
    origin = request.headers.get('Origin')
    if origin and origin != str(request.base_url).rstrip('/'):
        raise HTTPException(403, 'Origin rejected')


def folder(request: Request, runtime: Runtime):
    return runtime.folder(request.query_params.get('project_id') or request.cookies.get(PROJECT_COOKIE))


RUNTIME = Depends(get_runtime)
LOCAL = [Depends(local)]
WRITE = [Depends(write)]
