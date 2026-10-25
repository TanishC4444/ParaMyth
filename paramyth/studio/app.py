"""Assemble the studio API. Run it with `python -m paramyth.studio.serve`."""
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import images, library, music, planning, projects, search, workspace, writing
from .deps import TOKEN_HEADER, local
from .runtime import Runtime

FRONTEND = Path(__file__).resolve().parents[2] / 'frontend' / 'dist'


def create_app(root=None, frontend=FRONTEND):
    """Build the app for a workspace folder (PARAMYTH_WORKSPACE, or the current directory).
    A built frontend, when present, is served at / from the same local origin."""
    app = FastAPI(title='ParaMyth studio', version='0.1.0')
    app.state.runtime = Runtime(root or os.getenv('PARAMYTH_WORKSPACE') or Path.cwd())
    app.router.on_shutdown.append(app.state.runtime.close)

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
    if frontend and (Path(frontend) / 'index.html').is_file():
        app.mount('/', StaticFiles(directory=frontend, html=True), name='frontend')
    return app
