"""The project's file library: list and open outputs, never generated HTML or hidden files."""
import mimetypes

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse

from .deps import LOCAL, RUNTIME, folder

router = APIRouter(tags=['output library'], dependencies=LOCAL)


@router.get('/api/studio/outputs')
def outputs(request: Request, runtime=RUNTIME):
    return {'files': runtime.output_files(folder(request, runtime))}


@router.get('/api/studio/output')
def output(request: Request, path: str, download: bool = False, runtime=RUNTIME):
    file = runtime.output_path(folder(request, runtime), path)
    mime = mimetypes.guess_type(file.name)[0] or 'application/octet-stream'
    return FileResponse(file, media_type=mime, filename=file.name if download else None,
                        content_disposition_type='attachment' if download else 'inline', headers={'X-Content-Type-Options': 'nosniff'})
