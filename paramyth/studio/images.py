"""Image routes: prepare a prompt (optionally with Vultr), generate with Meta Muse, browse results."""
from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from .. import image_studio
from .. import image_references
from .deps import LOCAL, RUNTIME, WRITE, folder

router = APIRouter(tags=['images'], dependencies=LOCAL)


@router.get('/api/images/models')
def models():
    return {'models': image_studio.CATALOG.list()}


@router.get('/api/images')
def gallery(request: Request, runtime=RUNTIME):
    return {'images': image_studio.gallery(folder(request, runtime))}


@router.get('/api/images/references')
def references(request: Request, runtime=RUNTIME):
    return {'references': image_references.list_references(folder(request, runtime))}


@router.post('/api/images/references', dependencies=WRITE, status_code=201)
async def upload_reference(request: Request, name: str = 'Reference image', runtime=RUNTIME):
    current = folder(request, runtime)
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > image_references.MAX_UPLOAD_BYTES:
            raise HTTPException(413, 'Choose an image under 5 MB')
        chunks.append(chunk)
    return await run_in_threadpool(image_references.store_reference, current, b''.join(chunks), name)


@router.get('/media/image-references/{ident}')
def reference_preview(ident: str, request: Request, runtime=RUNTIME):
    value, path = image_references.read_reference(folder(request, runtime), ident)
    return FileResponse(path, media_type=value['mime'], headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})


@router.get('/api/images/{ident}')
def record(ident: str, request: Request, runtime=RUNTIME):
    return image_studio.read_record(folder(request, runtime), ident)


@router.get('/media/images/{ident}/{index}.png')
def media(ident: str, index: int, request: Request, download: bool = False, runtime=RUNTIME):
    path = image_studio.image_file(folder(request, runtime), ident, index)
    return FileResponse(path, media_type='image/png', filename=path.name if download else None,
                        content_disposition_type='attachment' if download else 'inline')


@router.post('/api/images/prepare', dependencies=WRITE, status_code=202)
def prepare(request: Request, data: dict = Body(...), runtime=RUNTIME):
    image_studio.input_spec(data)
    current, enhance = folder(request, runtime), bool(data.get('enhance', True))
    return {'job_id': runtime.submit('image-prompt', current, lambda progress: image_studio.prepare_prompt(current, data, enhance))}


@router.post('/api/images/generate', dependencies=WRITE, status_code=202)
def generate(request: Request, data: dict = Body(...), runtime=RUNTIME):
    image_studio.generation_settings(data, image_studio.CATALOG.get(data.get('model')))
    current = folder(request, runtime)
    image_references.validate_references(current, data)
    return {'job_id': runtime.submit('image', current, lambda progress: image_studio.generate(current, data, progress))}


@router.post('/api/images/create', dependencies=WRITE, status_code=202)
def create_from_story(request: Request, data: dict = Body(...), runtime=RUNTIME):
    """Prepare and render once in a durable job, without a second browser action."""
    from ..pipeline import image_studio as renderer, media_workspace
    renderer.input_spec(data)
    model = renderer.CATALOG.get(data.get('model'))
    renderer.generation_settings({**data, 'prompt': 'Preparing visual direction', 'n': 1}, model)
    current = folder(request, runtime)
    image_references.validate_references(current, data)
    selected = media_workspace.material(current, data.get('source', 'latest'), '', True)
    def operation(progress):
        progress('Preparing the visual from your writing')
        prepared = renderer.prepare_prompt(current, data, bool(data.get('enhance', True)), sources=selected['sources'])
        prompt = prepared['prompt'][:2900] + '\n' + media_workspace.NATURAL_FINISH
        result = renderer.generate(current, {**data, 'prompt': prompt, 'title': prepared['title'], 'n': 1}, progress)
        result.update(source_id=selected['source_id'], source_title=selected['title'], writing_signature=selected['signature'])
        from ..storage import save
        save(renderer.record_path(current, result['id']), result)
        return result
    return {'job_id': runtime.submit('image', current, operation)}
