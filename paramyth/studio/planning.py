"""Production planning routes: plans, local recalculation, exports and Google Calendar sync."""
import base64
import hashlib
import json
import os
import re
import secrets
import time
from urllib.parse import urlencode

from fastapi import APIRouter, Body, Request
from fastapi.responses import RedirectResponse, Response

from ..pipeline.production import budget, create_plan, normalize_config, schedule, validate_breakdown
from ..pipeline.production_exports import export
from ..storage import load, save
from .deps import LOCAL, RUNTIME, WRITE, folder

router = APIRouter(tags=['production planning'], dependencies=LOCAL)
PLAN_ID = re.compile('[a-f0-9]{24}')
OAUTH_SECONDS = 600


def read_plan(current, ident):
    if not PLAN_ID.fullmatch(str(ident)):
        raise ValueError('Invalid plan ID')
    return load(current / 'production' / 'plans' / (ident + '.json'))


def callback_url(request):
    from .accounts import origin
    return origin(request) + '/google/callback'


@router.get('/api/config')
def config(request: Request, runtime=RUNTIME):
    current = folder(request, runtime)
    paths = sorted((current / 'production' / 'plans').glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)[:20]
    return {'story': current.name, 'vultr': bool(os.getenv('VULTR_INFERENCE_API_KEY')), 'search': bool(os.getenv('SERPAPI_API_KEY')),
            'google': bool(runtime.google.access or runtime.google.refresh),
            'google_oauth': bool(os.getenv('GOOGLE_CLIENT_ID') and os.getenv('GOOGLE_CLIENT_SECRET')),
            'redirect_uri': callback_url(request), 'plans': [p.stem for p in paths]}


@router.post('/api/generate', dependencies=WRITE, status_code=202)
def generate(request: Request, data: dict = Body(...), runtime=RUNTIME):
    raw, images = data.get('config', {}), data.get('images', [])
    normalize_config(raw)
    if not isinstance(images, list) or len(images) > 3:
        raise ValueError('Use at most three scene images')
    current = folder(request, runtime)
    return {'job_id': runtime.submit('production', current, lambda progress: create_plan(current, raw, images, progress))}


@router.get('/api/plan/{ident}')
def plan(ident: str, request: Request, runtime=RUNTIME):
    return read_plan(folder(request, runtime), ident)


@router.post('/api/recalculate', dependencies=WRITE)
def recalculate(request: Request, data: dict = Body(...), runtime=RUNTIME):
    """Re-run the schedule and budget for edited scenes or rates without another model call."""
    current = folder(request, runtime)
    value = read_plan(current, data.get('id'))
    cfg = normalize_config(data.get('config', value['config']))
    breakdown = value['breakdown']
    breakdown['scenes'] = data.get('scenes', breakdown['scenes'])
    breakdown['budget_items'] = data.get('budget_items', breakdown.get('budget_items', []))
    validate_breakdown(breakdown)
    value.update(config=cfg, schedule=schedule(breakdown['scenes'], cfg), budget=budget(breakdown['budget_items'], cfg),
                 id=hashlib.sha256(json.dumps([data['id'], cfg, breakdown], sort_keys=True).encode()).hexdigest()[:24])
    if value.get('operations', {}).get('tasks'):
        from ..pipeline.production_operations import schedule_tasks
        schedule_tasks(value['operations'], cfg, value['schedule'])
    if value.get('local_logistics'):
        value['local_logistics']['stale'] = True
    value['warnings'] = value.get('warnings', []) + ['Schedule and budget edited locally; research recommendations were not regenerated.']
    save(current / 'production' / 'plans' / (value['id'] + '.json'), value)
    return value


@router.get('/export/{ident}/{kind}')
def download(ident: str, kind: str, request: Request, runtime=RUNTIME):
    raw, mime = export(read_plan(folder(request, runtime), ident), kind)
    return Response(raw, media_type=mime, headers={'Content-Disposition': f'attachment; filename="paramyth-{kind}"'})


@router.post('/api/calendar-sync', dependencies=WRITE)
def calendar_sync(request: Request, data: dict = Body(...), runtime=RUNTIME):
    return runtime.google.sync(read_plan(folder(request, runtime), data.get('id')), str(data.get('calendar', 'primary'))[:300])


@router.get('/google/connect')
def google_connect(request: Request, runtime=RUNTIME):
    client = os.getenv('GOOGLE_CLIENT_ID', '')
    if not client or not os.getenv('GOOGLE_CLIENT_SECRET'):
        raise ValueError('Configure Google OAuth credentials and register ' + callback_url(request))
    state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    runtime.oauth[state] = (time.time(), verifier)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    query = {'client_id': client, 'redirect_uri': callback_url(request), 'response_type': 'code',
             'scope': 'https://www.googleapis.com/auth/calendar.events', 'state': state, 'access_type': 'offline',
             'prompt': 'consent', 'code_challenge': challenge, 'code_challenge_method': 'S256'}
    return RedirectResponse('https://accounts.google.com/o/oauth2/v2/auth?' + urlencode(query))


@router.get('/google/callback')
def google_callback(request: Request, state: str = '', code: str = '', runtime=RUNTIME):
    item = runtime.oauth.pop(state, None)
    if not item or time.time() - item[0] > OAUTH_SECONDS or not code:
        raise ValueError('Google authorization expired or was not granted')
    runtime.google.accept(runtime.google.form_token({'grant_type': 'authorization_code', 'code': code,
                                                      'redirect_uri': callback_url(request), 'code_verifier': item[1]}))
    return RedirectResponse('/#/production')
