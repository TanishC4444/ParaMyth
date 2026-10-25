"""Soundtrack jobs: local ambience rendered on this machine, scores and songs from Vultr."""
import os
from pathlib import Path
import re
import secrets
import time

from fastapi import APIRouter, Body, Request
from fastapi.responses import FileResponse, StreamingResponse

from .. import soundtracks, vultr
from ..storage import load, save
from .deps import LOCAL, RUNTIME, WRITE, folder
from .music_archive import guard as archive_guard

router = APIRouter(tags=['soundtracks'], dependencies=LOCAL)
TRACK_ID = re.compile(r'(music|local)_[a-f0-9]{24}')
DONE = ('completed', 'failed', 'cancelled', 'expired')
MAX_SAVE_BYTES = 100 * 1024 * 1024


def record(current, ident):
    if not TRACK_ID.fullmatch(ident):
        raise ValueError('Invalid music ID')
    path = current / 'soundtracks' / (ident + '.json')
    if not path.is_file():
        raise ValueError('Music job does not belong to this project')
    return load(path)


@router.get('/api/studio/music/models')
def models():
    return {'data': soundtracks.models()}


@router.post('/api/studio/music', dependencies=WRITE, status_code=202)
def create(request: Request, data: dict = Body(...), runtime=RUNTIME):
    current = folder(request, runtime)
    mode, seconds = data.get('mode', 'score'), soundtracks.check_seconds(data.get('seconds', 60))
    direction, lyrics, model = str(data.get('direction', ''))[:1000], str(data.get('lyrics', ''))[:12000], data.get('model', 'minimax-music3')
    cue = soundtracks.plan(current, mode, direction)
    if mode != 'ambience':
        vultr.require_key()

    def operation(progress):
        if mode == 'ambience':
            ident = 'local_' + secrets.token_hex(12)
            target = current / 'soundtracks' / (ident + '.wav')
            target.parent.mkdir(parents=True, exist_ok=True)
            progress('Rendering local ambience')
            with target.open('wb') as out:
                for block in soundtracks.wav_stream(cue, seconds):
                    out.write(block)
            value = {'id': ident, 'cue': cue, 'provider': 'local procedural', 'job': {'id': ident, 'status': 'completed'}, 'file': target.name}
            save(current / 'soundtracks' / (ident + '.json'), value)
            return value
        progress('Submitting the soundtrack to Vultr')
        job, _ = soundtracks.create(current, mode, model, seconds, direction, lyrics)
        value = {**load(current / 'soundtracks' / (job['id'] + '.json')), 'provider': vultr.PROVIDER}
        save(current / 'soundtracks' / (job['id'] + '.json'), value)
        return value
    return {'job_id': runtime.submit('music', current, operation)}


@router.get('/api/studio/music')
def tracks(request: Request, runtime=RUNTIME):
    rows, seen = [], set()
    paths = sorted((folder(request, runtime) / 'soundtracks').glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)[:100]
    for path in paths:
        value = load(path)
        ident = value.get('job', {}).get('id')
        if ident and ident not in seen:
            rows.append(value)
            seen.add(ident)
    return {'tracks': rows}


@router.get('/api/studio/music/{ident}')
def status(ident: str, request: Request, runtime=RUNTIME):
    with archive_guard:
        current = folder(request, runtime)
        value = record(current, ident)
        # Poll the provider at most every five seconds per track.
        if ident.startswith('music_') and value['job'].get('status') not in DONE and time.time() - value.get('last_check', 0) > 5:
            value.update(job=soundtracks.status(ident), last_check=time.time())
            save(current / 'soundtracks' / (ident + '.json'), value)
        return value


@router.get('/media/music/{ident}/{action}')
def media(ident: str, action: str, request: Request, runtime=RUNTIME):
    current = folder(request, runtime)
    value = record(current, ident)
    if action not in ('stream', 'content'):
        raise ValueError('Invalid music action')
    if ident.startswith('local_'):
        return FileResponse(current / 'soundtracks' / Path(value['file']).name, media_type='audio/wav')
    if value.get('file'):
        return FileResponse(current / 'soundtracks' / Path(value['file']).name, media_type='audio/mpeg')
    response = soundtracks.audio(ident, 'content' if value['job'].get('status') == 'completed' else action)

    def chunks():
        try:
            while block := response.read(8192):
                yield block
        finally:
            response.close()
    return StreamingResponse(chunks(), media_type=response.headers.get('Content-Type', 'audio/mpeg'))


@router.post('/api/studio/music/{ident}/save', dependencies=WRITE)
def keep(ident: str, request: Request, runtime=RUNTIME):
    with archive_guard:
        current = folder(request, runtime)
        value = record(current, ident)
        if value['job'].get('status') != 'completed':
            raise ValueError('Wait for generation to complete before saving')
        if ident.startswith('local_'):
            return {'file': 'soundtracks/' + value['file']}
        target = current / 'soundtracks' / (ident + '.mp3')
        if not target.exists():
            temporary = target.with_suffix('.mp3.tmp')
            try:
                soundtracks.download(ident, temporary, limit=MAX_SAVE_BYTES)
                os.replace(temporary, target)
            finally:
                temporary.unlink(missing_ok=True)
        value['file'] = target.name
        save(current / 'soundtracks' / (ident + '.json'), value)
        return {'file': 'soundtracks/' + target.name}


@router.post('/api/studio/music/{ident}/cancel', dependencies=WRITE)
def cancel(ident: str, request: Request, runtime=RUNTIME):
    with archive_guard:
        current = folder(request, runtime)
        value = record(current, ident)
        if ident.startswith('local_'):
            raise ValueError('Local ambience is already complete')
        soundtracks.cancel(ident)
        value['job']['status'] = 'cancelled'
        save(current / 'soundtracks' / (ident + '.json'), value)
        return {'cancelled': True}
