"""Assemble the studio API. Run it with `python -m paramyth.studio.serve`."""
import os
import mimetypes
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.staticfiles import StaticFiles

from . import images, library, music, news, planning, projects, search, workspace, writing
from .deps import LOCAL, TOKEN_HEADER, get_runtime, local, write
from .runtime import Runtime
from .studios import router as accounts_router
from .studio_http import StudioHTTPMiddleware, studio_path

FRONTEND = Path(__file__).resolve().parents[2] / 'frontend' / 'dist'
ACCOUNTS_UI = Path(__file__).resolve().parents[2] / 'web'
PUBLIC_ASSETS = Path(__file__).resolve().parents[2] / 'frontend' / 'public'


class StudioApp(FastAPI):
    def build_middleware_stack(self):
        stack = super().build_middleware_stack()
        # Wrap ServerErrorMiddleware too: add_middleware puts CORS inside it,
        # hiding unhandled 500s (and outer middleware rejections) from browsers.
        # Keep the FastAPI instance so routes, state and lifespan work as usual.
        if self.state.frontend_origin:
            stack = CORSMiddleware(stack, allow_origins=[self.state.frontend_origin],
                allow_credentials=True, allow_methods=['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
                allow_headers=['Accept', 'Content-Type', 'Authorization', 'X-ParaMyth-Token', 'X-ParaMyth-Account'],
                expose_headers=['Content-Disposition'], max_age=600)
        return stack


def create_app(root=None, frontend=FRONTEND, *, account_workspaces=None, public_origin=None):
    """Build the app for a workspace folder (PARAMYTH_WORKSPACE, or the current directory).
    A built frontend, when present, is served at / from the same local origin."""
    from .server_settings import load_server_environment
    load_server_environment()
    app = StudioApp(title='ParaMyth studio', version='0.1.0')
    # Slim Linux images may omit the system MIME database used by StaticFiles.
    mimetypes.add_type('image/webp', '.webp')
    public_origin = public_origin if public_origin is not None else os.getenv('PARAMYTH_PUBLIC_ORIGIN', '')
    account_workspaces = account_workspaces if account_workspaces is not None else os.getenv('PARAMYTH_ACCOUNT_WORKSPACES') == '1'
    app.state.account_workspaces = bool(account_workspaces or public_origin)
    app.state.public_origin = ''
    app.state.frontend_origin = ''
    if public_origin:
        from .hosting import validate_origin
        app.state.public_origin = validate_origin(public_origin)
        if os.getenv('PARAMYTH_FRONTEND_ORIGIN'):
            app.state.frontend_origin = validate_origin(os.environ['PARAMYTH_FRONTEND_ORIGIN'])
        if not (root or os.getenv('PARAMYTH_WORKSPACE')):
            raise ValueError('Hosted mode requires PARAMYTH_WORKSPACE on a persistent volume')
    root = root or os.getenv('PARAMYTH_WORKSPACE') or Path.cwd()
    app.state.shared_root = Path(root).resolve()
    if app.state.account_workspaces:
        from cryptography.fernet import Fernet
        from .hosting import HostedRequests
        from .user_workspaces import Workspaces
        key = os.getenv('PARAMYTH_ENCRYPTION_KEY', '')
        if not key:
            raise ValueError('Set a persistent PARAMYTH_ENCRYPTION_KEY before enabling account workspaces')
        Fernet(key)  # Fail before accepting requests if the encryption key is invalid.
        app.state.workspaces = Workspaces(root, key)
        app.router.on_shutdown.append(app.state.workspaces.close)
        app.add_middleware(HostedRequests)
    else:
        app.state.runtime = Runtime(root)
        app.router.on_shutdown.append(app.state.runtime.close)
    app.add_middleware(StudioHTTPMiddleware)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        if studio_path(request.url.path):
            # Default validation responses can echo submitted passwords and tokens.
            return JSONResponse({'detail': [{'loc': e['loc'], 'msg': e['msg'], 'type': e['type']}
                                           for e in exc.errors()]}, status_code=422)
        return await request_validation_exception_handler(request, exc)

    @app.exception_handler(ValueError)
    async def invalid(_, exc):
        return JSONResponse({'detail': str(exc)}, status_code=422)

    @app.get('/api/v1/health', tags=['studio configuration'])
    def health():
        return {'status': 'ok'}

    @app.get('/api/ui/session', tags=['studio configuration'])
    def session(request: Request):
        local(request)
        from .accounts import csrf, user
        runtime = get_runtime(request)
        account = user(request) if app.state.account_workspaces else None
        return JSONResponse({'csrf': csrf(request) if account else runtime.token, 'header': TOKEN_HEADER,
                             'mode': 'live', 'user_id': str(account['id']) if account else None},
                            headers={'Cache-Control': 'no-store'})

    @app.get('/api/ui/public-config', tags=['studio configuration'])
    def public_config():
        return {'accounts_required': app.state.account_workspaces,
                'shared_keys': app.state.account_workspaces, 'github_admin': not app.state.account_workspaces}

    app.include_router(projects.router)
    if app.state.account_workspaces:
        # Full author/media workspace, with every dependency using the signed-in
        # user's runtime. Do not expose the shared GitHub administration router.
        from ..pipeline.api import ui_workspace, studio_routes, atlas
        app.dependency_overrides[studio_routes.get_runtime] = get_runtime
        app.dependency_overrides[studio_routes.local] = local
        app.dependency_overrides[studio_routes.write] = write
        app.include_router(ui_workspace.router)
        from .team_workspace import router as team_router
        app.include_router(team_router)
        app.include_router(atlas.router)
    else:
        app.include_router(workspace.router)
        app.include_router(writing.router)
    app.include_router(music.router)
    if not app.state.account_workspaces:
        app.include_router(music.local_router)
    app.include_router(images.router)
    app.include_router(planning.router)
    app.include_router(library.router)
    app.include_router(search.router)
    app.include_router(news.router)
    app.include_router(accounts_router)
    from .discovery import router as discovery_router
    from .research import router as research_router
    app.include_router(discovery_router)
    app.include_router(research_router)
    if not app.state.account_workspaces:
        @app.get('/api/ui/writing/export', dependencies=LOCAL)
        def writing_export(request: Request, format: str = 'docx', scene_id: str = '', packet: str = 'manuscript'):
            from urllib.parse import quote
            from fastapi.responses import Response
            from .deps import folder
            from ..pipeline.writing_exports import export_writing
            body, mime, filename = export_writing(folder(request, app.state.runtime), format, scene_id, packet)
            return Response(body, media_type=mime, headers={'Content-Disposition': "attachment; filename*=UTF-8''" + quote(filename)})
    # Register before the frontend catch-all so its account links resolve.
    if app.state.frontend_origin:
        @app.get('/studio/{path:path}', include_in_schema=False)
        def frontend_account(request: Request, path: str):
            query = '?' + request.url.query if request.url.query else ''
            return RedirectResponse(app.state.frontend_origin + '/studio/' + path + query)
    elif ACCOUNTS_UI.is_dir():
        app.mount('/studio', StaticFiles(directory=ACCOUNTS_UI, html=True), name='accounts-ui')
    # Account-page artwork must also work when only the API has been started.
    # Prefer built assets when a frontend is supplied, with source assets as fallback.
    for asset in ('art', 'brand'):
        built = Path(frontend) / asset if frontend else None
        directory = built if built and built.is_dir() else PUBLIC_ASSETS / asset
        if directory.is_dir():
            app.mount('/' + asset, StaticFiles(directory=directory), name=asset)
    built_icon = Path(frontend) / 'favicon.svg' if frontend else None
    icon = built_icon if built_icon and built_icon.is_file() else PUBLIC_ASSETS / 'favicon.svg'
    if icon.is_file():
        @app.get('/favicon.svg', include_in_schema=False)
        def favicon():
            return FileResponse(icon, media_type='image/svg+xml')

        @app.get('/favicon.ico', include_in_schema=False)
        def favicon_alias():
            return RedirectResponse('/favicon.svg')
    if app.state.frontend_origin:
        @app.get('/', include_in_schema=False)
        def frontend_redirect():
            return RedirectResponse(app.state.frontend_origin + '/')
    elif frontend and (Path(frontend) / 'index.html').is_file():
        @app.get('/', include_in_schema=False)
        @app.get('/index.html', include_in_schema=False)
        def frontend_index():
            # The same frontend also ships as a static site without API access.
            html = (Path(frontend) / 'index.html').read_text(encoding='utf-8')
            return HTMLResponse(html.replace('<head>', '<head><meta name="paramyth-studio" content="live">', 1),
                                headers={'Cache-Control': 'no-store'})
        app.mount('/', StaticFiles(directory=frontend, html=True), name='frontend')
    return app
