"""Author workspace: projects, field-level drafts, notes and the run request for each project."""
import json
import re

from fastapi import APIRouter, Body, HTTPException, Request

from ..storage import load, save
from .author import export_request, project, read, revision, validate_project
from .deps import LOCAL, PROJECT_COOKIE, RUNTIME, WRITE
from .runtime import now

router = APIRouter(prefix='/api/ui', tags=['author workspace'], dependencies=LOCAL)
DRAFT_FIELD = re.compile(r'[a-z][a-zA-Z0-9_.-]{0,79}')


def notes_path(runtime):
    return runtime.root / 'runs' / 'paramyth-workspace.json'


def view(runtime, ident):
    return project(runtime.folder(ident), ident, runtime.root)


@router.get('/workspace')
def workspace(request: Request, runtime=RUNTIME):
    items = [p for p in (view(runtime, x['id']) for x in runtime.project_list()) if p is not None]
    current = request.cookies.get(PROJECT_COOKIE)
    if current not in {p['id'] for p in items}:
        current = items[0]['id'] if items else ''
    meta = read(notes_path(runtime), {})
    return {'projects': items, 'current': current, 'ideas': meta.get('ideas', []), 'pins': meta.get('pins', []),
            'drafts': {p['id']: read(runtime.folder(p['id']) / 'workspace-drafts.json', {}) for p in items}}


@router.patch('/projects/{ident}/workspace', dependencies=WRITE)
def save_drafts(ident: str, data: dict = Body(...), runtime=RUNTIME):
    # Field-level patches let separate tabs save without replacing each other's work.
    if len(data) > 150 or any(not DRAFT_FIELD.fullmatch(k) for k in data):
        raise ValueError('Invalid workspace field')
    if len(json.dumps(data, allow_nan=False)) > 2_000_000:
        raise ValueError('Workspace drafts are too large')
    target = runtime.folder(ident) / 'workspace-drafts.json'
    with runtime.guard:
        updated = {**read(target, {}), **data}
        if len(json.dumps(updated, allow_nan=False)) > 4_000_000:
            raise ValueError('Workspace drafts are too large')
        save(target, updated)
    return {'saved': True}


@router.put('/notes', dependencies=WRITE)
def notes(data: dict = Body(...), runtime=RUNTIME):
    if len(json.dumps(data)) > 1_000_000:
        raise ValueError('Notes are too large')
    save(notes_path(runtime), {'ideas': data.get('ideas', []), 'pins': data.get('pins', [])})
    return {'saved': True}


@router.put('/projects/{ident}', dependencies=WRITE)
def update(ident: str, data: dict = Body(...), runtime=RUNTIME):
    validate_project(data)
    if data.get('id') != ident:
        raise ValueError('Invalid project')
    root = runtime.folder(ident)
    target = root / 'author-workspace.json'
    with runtime.guard:
        if data.get('revision', 'new') != revision(target):
            raise HTTPException(409, 'This project changed elsewhere. Reload it before saving your changes.')
        old = read(root / 'request.json', {})
        if target.exists():
            save(root / 'author-revisions' / (now().replace(':', '-') + '.json'), load(target))
        elif old:
            save(root / 'author-original-request.json', old)
        data = {**data, 'updated': now()}
        data.pop('revision', None)
        save(target, data)
        save(root / 'request.json', export_request(data, old))
        # Generated scenes and state stay intact; the author draft is a separate, explicit source.
        save(root / 'author-draft.txt', '\n\n'.join(s.get('content', '') for s in data['scenes']))
        return {**data, 'revision': revision(target)}


@router.post('/projects', dependencies=WRITE)
def create(data: dict = Body(...), runtime=RUNTIME):
    p = validate_project(data.get('project'))
    ident = runtime.create_project(p['title'], p['brief']['premise'] or ' ', export_request(p, {}))
    return update(ident, {**p, 'id': ident, 'revision': 'new'}, runtime)


@router.get('/projects/{ident}/request')
def run_request(ident: str, runtime=RUNTIME):
    p = view(runtime, ident)
    if p is None:
        raise ValueError('Fixture projects cannot be used in the studio')
    result = export_request(p, read(runtime.folder(ident) / 'request.json', {}))
    references = {r['record_id']: r for r in result.get('references', []) if isinstance(r, dict) and 'record_id' in r}
    for pin in read(notes_path(runtime), {}).get('pins', []):
        if pin.get('projectId') == ident:
            references[pin['recordId']] = {'record_id': pin['recordId'], 'scope': 'story', 'purpose': pin.get('purpose') or 'Literary inspiration'}
    result['references'] = list(references.values())
    return result
