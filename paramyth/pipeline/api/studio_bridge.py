"""Optional loopback bridge to already configured services during UI development.
No credentials leave the original service and no synthetic results are substituted.
"""
import os
import re
from urllib.parse import urlsplit
import httpx
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, StreamingResponse


def loopback(name):
    value=os.getenv(name,'').rstrip('/')
    if value and (urlsplit(value).scheme!='http' or urlsplit(value).hostname not in ('127.0.0.1','localhost','::1')):
        raise ValueError(name+' must be an HTTP loopback origin')
    return value


class StudioBridge(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path=request.url.path
        # Production plans are created by the current workspace. Sending their
        # edits/exports to an older connected studio drops department tasks and
        # rejects newer schedule/research settings. Local routes retain their
        # own request-token and project guards.
        if path in ('/api/config','/api/recalculate','/api/calendar-sync') or path.startswith(('/api/plan/','/export/','/google/')):
            return await call_next(request)
        account=path.startswith(('/api/v1/accounts','/api/v1/studios','/api/v1/invitations'))
        core=path.startswith(('/api/v1/auth','/api/v1/runs','/api/v1/requests'))
        upstream=loopback('PARAMYTH_ACCOUNT_ORIGIN') if account else loopback('PARAMYTH_SERVICE_ORIGIN')
        forwarded=account or core or path.startswith(('/api/studio/','/api/job/','/api/images','/api/config','/api/generate','/api/plan/','/api/recalculate','/api/calendar-sync','/media/','/export/','/google/'))
        if not upstream or not forwarded:return await call_next(request)
        from .studio_routes import local,write,get_runtime
        try:
            local(request)
            if request.headers.get('origin') and request.headers['origin'].rstrip('/')!=str(request.base_url).rstrip('/'):
                return JSONResponse({'detail':'Cross-origin request rejected'},status_code=403)
            if not account and request.method not in ('GET','HEAD'):write(request,get_runtime())
        except Exception as exc:
            return JSONResponse({'detail':getattr(exc,'detail','Request rejected')},status_code=getattr(exc,'status_code',403))
        client=httpx.AsyncClient(timeout=200,follow_redirects=False)
        try:
            headers={k:v for k,v in request.headers.items() if k.lower() not in ('host','content-length','origin','x-paramyth-token','connection')}
            if core:
                if headers.get('authorization')=='Bearer demo':
                    await client.aclose()
                    return JSONResponse({'detail':'Demo data is disabled in this live workspace'},status_code=403)
                headers.setdefault('authorization','Bearer server')
            if request.headers.get('origin'):headers['origin']=upstream
            if not account and request.method not in ('GET','HEAD'):
                page=await client.get(upstream+'/ideas')
                match=re.search(r"const CSRF='([A-Za-z0-9_-]+)'",page.text)
                if not match:raise ValueError('The configured studio did not supply a request token')
                headers['X-ParaMyth-Token']=match[1]
            if not account and request.query_params.get('project_id'):
                ident=request.query_params['project_id'];get_runtime().folder(ident)
                cookies=[v.strip() for v in headers.get('cookie','').split(';') if v.strip() and not v.strip().startswith('pm_pipeline_project=')]
                headers['cookie']='; '.join(cookies+['pm_pipeline_project='+ident])
            target=upstream+path+('?' + request.url.query if request.url.query else '')
            response=await client.send(client.build_request(request.method,target,headers=headers,content=await request.body()),stream=True)
            async def stream():
                try:
                    async for chunk in response.aiter_raw():yield chunk
                finally:await response.aclose();await client.aclose()
            out=StreamingResponse(stream(),status_code=response.status_code)
            out.raw_headers=[(k,v) for k,v in response.headers.raw if k.lower() not in (b'transfer-encoding',b'connection')]
            return out
        except (httpx.HTTPError,ValueError):
            await client.aclose()
            return JSONResponse({'detail':'The configured live studio is unavailable. Start it or check Connections.'},status_code=503)
