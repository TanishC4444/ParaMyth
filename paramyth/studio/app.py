"""Assemble the studio API. Run it with `python -m paramyth.studio.serve`."""
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.staticfiles import StaticFiles

from . import images, library, music, planning, projects, search, workspace, writing
from .deps import TOKEN_HEADER, local
from .runtime import Runtime
from .studios import router as accounts_router
from .studio_http import StudioHTTPMiddleware, studio_path

FRONTEND = Path(__file__).resolve().parents[2] / 'frontend' / 'dist'
ACCOUNTS_UI = Path(__file__).resolve().parents[2] / 'web'
PUBLIC_ASSETS = Path(__file__).resolve().parents[2] / 'frontend' / 'public'


def create_app(root=None, frontend=FRONTEND):
    """Build the app for a workspace folder (PARAMYTH_WORKSPACE, or the current directory).
    A built frontend, when present, is served at / from the same local origin."""
    app = FastAPI(title='ParaMyth studio', version='0.1.0')
    app.state.runtime = Runtime(root or os.getenv('PARAMYTH_WORKSPACE') or Path.cwd())
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
        return JSONResponse({'csrf': app.state.runtime.token, 'header': TOKEN_HEADER, 'mode': 'live'},
                            headers={'Cache-Control': 'no-store'})

    app.include_router(projects.router)
    app.include_router(workspace.router)
    app.include_router(writing.router)
    app.include_router(music.router)
    app.include_router(images.router)
    app.include_router(planning.router)
    app.include_router(library.router)
    app.include_router(search.router)
    app.include_router(accounts_router)
    # Register before the frontend catch-all so its account links resolve.
    if ACCOUNTS_UI.is_dir():
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
    if frontend and (Path(frontend) / 'index.html').is_file():
        app.mount('/', StaticFiles(directory=frontend, html=True), name='frontend')
    return app
