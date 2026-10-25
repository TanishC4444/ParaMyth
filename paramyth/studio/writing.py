"""Creative writing jobs with live draft events, and adopting a result as a new project."""
import asyncio
from copy import deepcopy
import json
import re

from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.responses import StreamingResponse

from .. import creative, vultr
from ..storage import load, save
from .author import MEDIA, export_request
from .deps import LOCAL, RUNTIME, WRITE, folder
from .runtime import now
from .workspace import update

router = APIRouter(prefix='/api/ui/creative', tags=['creative writing'], dependencies=LOCAL)
FINISHED = ('complete', 'failed', 'interrupted', 'cancelled')
RESULT_ID = re.compile('[a-f0-9]{24}')


@router.post('', dependencies=WRITE, status_code=202)
def start(request: Request, data: dict = Body(...), runtime=RUNTIME):
    cfg = creative.validate(data)
    vultr.require_key()
    current = folder(request, runtime)
    ident = runtime.submit('creative', current, lambda progress: creative.run(current, cfg, progress, stream=True), streaming=True)
    return {'job_id': ident, 'streaming': True}


@router.get('')
def records(request: Request, runtime=RUNTIME):
    paths = sorted((folder(request, runtime) / 'creative').glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)[:50]
    return {'results': [load(p) for p in paths]}


@router.get('/jobs')
def jobs(request: Request, runtime=RUNTIME):
    ident = runtime.project_id(folder(request, runtime))
    with runtime.guard:
        rows = [dict(j) for j in runtime.jobs.values() if j['project_id'] == ident and j.get('streaming')]
    return {'jobs': sorted(rows, key=lambda j: j['created_at'], reverse=True)[:50]}


@router.get('/jobs/{ident}')
def job(ident: str, request: Request, runtime=RUNTIME):
    with runtime.guard:
        value = dict(runtime.job(ident))
    if value['project_id'] != runtime.project_id(folder(request, runtime)) or not value.get('streaming'):
        raise HTTPException(404, 'Writing job not found in this project')
    return value


@router.get('/jobs/{ident}/events')
async def events(ident: str, request: Request, runtime=RUNTIME):
    """Replay the job's latest state, then each change. Disconnecting never stops the work."""
    job(ident, request, runtime)

    async def stream():
        last, idle = None, 0
        while not await request.is_disconnected():
            with runtime.guard:
                value = dict(runtime.job(ident))
            encoded = json.dumps(value, ensure_ascii=False)
            if encoded != last:
                yield 'event: progress\ndata: ' + encoded + '\n\n'
                last, idle = encoded, 0
            elif idle >= 150:
                yield ': keepalive\n\n'
                idle = 0
            if value['status'] in FINISHED:
                break
            idle += 1
            await asyncio.sleep(.1)
    return StreamingResponse(stream(), media_type='text/event-stream', headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


def author_project(value):
    """Turn a completed result into an author project without discarding the model's decisions."""
    result = value.get('result')
    if value.get('status') != 'complete' or not isinstance(result, dict):
        raise ValueError('Only a completed creative result can become a project')
    text = result.get('text')
    if not isinstance(text, str) or not text.strip():
        raise ValueError('This creative result has no idea or prose text to use')
    source = result.get('completed_brief', {})
    if not isinstance(source, dict):
        raise ValueError('The saved creative brief must be an object')

    def string(*keys, default=''):
        return next((source[k] for k in keys if isinstance(source.get(k), str)), default)

    def strings(*keys):
        item = next((source[k] for k in keys if k in source), [])
        return [item] if isinstance(item, str) and item else [s for s in item if isinstance(s, str)] if isinstance(item, list) else []

    def count(*keys, default):
        return next((source[k] for k in keys if type(source.get(k)) is int and source[k] > 0), default)
    medium = string('medium', default='Novel')
    medium = MEDIA.get(medium.lower().replace(' ', '_'), medium)
    if medium not in MEDIA.values():
        raise ValueError('Choose a supported medium in the creative brief before adopting it: ' + ', '.join(sorted(set(MEDIA.values()))))
    cast = source.get('characters', [])
    if not isinstance(cast, list):
        raise ValueError('The creative brief character list is invalid')
    characters = []
    for index, item in enumerate(cast):
        item = {'name': item} if isinstance(item, str) else item
        if not isinstance(item, dict):
            raise ValueError('A creative character must have a name or character details')
        arc = item.get('arc') if isinstance(item.get('arc'), dict) else {}
        field = lambda key: item[key] if isinstance(item.get(key), str) else ''
        beat = lambda key, legacy: next((arc[k] for k in (key, legacy) if isinstance(arc.get(k), str)), '')
        characters.append({**deepcopy(item), 'id': f'character-{index + 1}', 'name': field('name'), 'goal': field('goal'), 'fear': field('fear'),
                           'voice': field('voice'), 'arc': {'belief': beat('belief', 'starting_belief'), 'pressure': beat('pressure', 'pressure_test'),
                                                            'choice': beat('choice', 'costly_choice'), 'change': beat('change', 'possible_change')}})
    low = count('wordMin', default=600)
    high = count('wordMax', default=max(low, 1200))
    high = max(low, high)
    brief = {**deepcopy(source), 'premise': string('premise', default=text), 'medium': medium, 'genre': string('genre'),
             'tone': string('tone', 'tone_mood'), 'pov': string('pov'), 'themes': strings('themes', 'theme_keywords'),
             'worldRules': strings('worldRules', 'world_rules'), 'mustAvoid': strings('mustAvoid', 'must_avoid'),
             'chapters': min(100, count('chapters', default=1)), 'scenesPerChapter': min(100, count('scenesPerChapter', 'scenes_per_chapter', default=1)),
             'wordMin': min(20000, low), 'wordMax': min(20000, high), 'lengthMode': 'Guided', 'characters': characters}
    title = result.get('title')
    title = title.strip()[:150] if isinstance(title, str) and title.strip() else 'Creative idea'
    scene = 'Developed idea' if value.get('request', {}).get('operation') == 'ideas' else 'Creative draft'
    return {'id': '', 'title': title, 'owner': 'Your workspace', 'color': 'mint', 'updated': now(), 'brief': brief, 'canon': [], 'versions': [],
            'scenes': [{'id': 'creative-draft', 'chapter': 1, 'title': scene, 'pov': '', 'location': '', 'content': text, 'state': 'Draft',
                        'findings': [], 'minutes': max(1, len(text.split()) // 150), 'night': False}]}


@router.post('/{ident}/use-as-project', dependencies=WRITE)
def adopt(ident: str, request: Request, runtime=RUNTIME):
    if not RESULT_ID.fullmatch(ident):
        raise ValueError('Invalid creative result ID')
    source = folder(request, runtime)
    value = load(source / 'creative' / (ident + '.json'))
    p = author_project(value)
    original = deepcopy(value['result'].get('completed_brief', {}))
    provenance = {'source_project_id': runtime.project_id(source), 'creative_result_id': ident, 'completed_brief': original,
                  'assumptions': deepcopy(value['result'].get('assumptions', [])), 'suggestions': deepcopy(value['result'].get('suggestions', []))}
    p['creative_source'] = provenance
    # Keep structure, stakes, ending and other authored fields for later runs.
    req = export_request(p, {**original, 'characters': p['brief']['characters']})
    req['creative_source'] = provenance
    created = runtime.create_project(p['title'], value['result']['text'], req)
    saved = update(created, {**p, 'id': created, 'revision': 'new'}, runtime)
    save(runtime.folder(created) / 'creative-source.json', value)
    return {'id': created, 'project': saved}
