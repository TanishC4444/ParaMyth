"""Project selection, the shared job list and server capabilities."""
import json
import os

from fastapi import APIRouter, Body, Request, Response

from .. import image_studio
from .deps import LOCAL, PROJECT_COOKIE, RUNTIME, WRITE, folder

router = APIRouter(tags=['studio projects'])


def selected(ident):
    response = Response(json.dumps({'id': ident}), media_type='application/json')
    response.set_cookie(PROJECT_COOKIE, ident, httponly=True, samesite='strict')
    return response


@router.get('/api/studio/projects', dependencies=LOCAL)
def projects(request: Request, runtime=RUNTIME):
    return {'projects': runtime.project_list(), 'current': runtime.project_id(folder(request, runtime))}


@router.post('/api/studio/projects', dependencies=WRITE)
def new_project(data: dict = Body(...), runtime=RUNTIME):
    return selected(runtime.create_project(data.get('title', ''), data.get('text', ''), data.get('brief')))


@router.post('/api/studio/project/select', dependencies=WRITE)
def select_project(data: dict = Body(...), runtime=RUNTIME):
    runtime.folder(data.get('id'))
    return selected(data['id'])


@router.get('/api/studio/jobs', dependencies=LOCAL)
def job_list(request: Request, runtime=RUNTIME):
    ident = runtime.project_id(folder(request, runtime))
    with runtime.guard:
        rows = [dict(j) for j in runtime.jobs.values() if j['project_id'] == ident]
    return {'jobs': sorted(rows, key=lambda j: j['created_at'], reverse=True)[:50]}


@router.get('/api/job/{ident}', dependencies=LOCAL)
def job(ident: str, runtime=RUNTIME):
    with runtime.guard:
        value = dict(runtime.job(ident))
    result = value.get('result') or {}
    # Older screens read the produced record's ID under a kind-specific name.
    extra = {'image-prompt': {'prompt_result': result}, 'image': {'image_id': result.get('id')},
             'production': {'plan_id': result.get('id')}}.get(value['kind'], {}) if result else {}
    return {**value, **extra}


def configured():
    return {'vultr': bool(os.getenv('VULTR_INFERENCE_API_KEY')), 'muse_image': bool(image_studio.muse_key()),
            'serpapi': bool(os.getenv('SERPAPI_API_KEY')),
            'google_oauth': bool(os.getenv('GOOGLE_CLIENT_ID') and os.getenv('GOOGLE_CLIENT_SECRET')),
            'github_server_token': bool(os.getenv('PARAMYTH_GITHUB_TOKEN'))}


@router.get('/api/studio/features', tags=['studio configuration'], dependencies=LOCAL)
def features():
    return {'framework': 'FastAPI', 'configured': configured(),
            'features': ['projects', 'background jobs', 'ideas', 'drafting', 'critique', 'revision loop', 'image generation',
                         'image prompt preparation', 'Vultr film scores and songs', 'local ambience', 'production schedules',
                         'budget arithmetic', 'web research', 'Google Calendar sync', 'ICS/CSV/call-sheet exports', 'output library']}
