"""Story-aware soundtrack cues, local procedural soundscapes and Vultr music jobs."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import re
import struct
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener

from . import vultr
from .providers import NoRedirect, ProviderError, request_json
from .storage import save
from .story_context import context

MODES = ('ambience', 'score', 'song')
JOB_ID = re.compile(r'music_[a-f0-9]{24}')
MAX_AUDIO_BYTES = 64 * 1024 * 1024
SCORE_LYRICS = '[Instrumental]\n[Intro]\n[Instrumental]\n[Bridge]\n[Instrumental]\n[Outro]'
SCORE_PROMPT = ('Cinematic orchestral film score. Instrumental throughout; no singing, choir, speech or vocals. '
                'Develop an emotional theme from sparse strings through dramatic percussion and brass into a '
                'restrained resolution.\n')


def plan(folder, mode='ambience', direction=''):
    """Build a cue from the story's own artifacts and the author's direction."""
    if mode not in MODES:
        raise ValueError('Choose ambience, score or song')
    sources = context(folder)
    # Give every artifact room rather than dropping characters behind prose.
    allowance = max(200, 4800 // len(sources))
    excerpts = '\n'.join(x['file'] + ': ' + x['text'][:allowance] for x in sources)[:4800]
    text = ' '.join(x['text'] for x in sources).lower() + ' ' + direction.lower()
    layers = [name for name, pattern in (
        ('water', r'harbou?r|ocean|sea\b|wave|river|ship|rain|storm'),
        ('wind', r'wind|storm|mountain|forest|desert|cold'),
        ('rumble', r'horror|fear|dread|dark|danger|battle|thunder|tension'),
        ('fire', r'fire|flame|hearth|camp|burn')) if re.search(pattern, text)] or ['wind']
    instruction = {'ambience': 'Environmental soundscape. No melody, singing, speech or musical instruments.',
                   'score': 'Instrumental dramatic underscore. No vocals or spoken narration.',
                   'song': 'A song inspired by this story and its characters.'}[mode]
    return {'mode': mode, 'layers': layers, 'sources': [x['file'] for x in sources],
            'prompt': (instruction + '\nAuthor direction: ' + direction[:400] + '\nStory, characters and world:\n' + excerpts)[:5900]}


def check_seconds(seconds):
    if type(seconds) is not int or not 5 <= seconds <= 360:
        raise ValueError('Duration must be 5–360 seconds')
    return seconds


def wav_stream(cue, seconds=60, rate=16000):
    """Finite mono PCM WAV yielded in small blocks; the same cue always sounds the same."""
    count = rate * check_seconds(seconds)
    yield (b'RIFF' + struct.pack('<I', 36 + count * 2) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, rate, rate * 2, 2, 16)
           + b'data' + struct.pack('<I', count * 2))
    digest = hashlib.sha256(cue['prompt'].encode()).digest()
    rng = random.Random(digest)
    low, layers = 0.0, cue['layers']
    base = 55 + digest[0] % 30
    for start in range(0, count, 2048):
        block = bytearray()
        for i in range(start, min(start + 2048, count)):
            t = i / rate
            noise = rng.uniform(-1, 1)
            low = .985 * low + .015 * noise
            value = 0.0
            if 'wind' in layers:
                value += low * (1.5 + math.sin(t * .31))
            if 'water' in layers:
                value += noise * (.05 + .07 * (1 + math.sin(t * .7)))
            if 'rumble' in layers:
                value += low * 2.5
            if 'fire' in layers:
                value += noise * (.5 if rng.random() < .012 else .025)
            if cue['mode'] == 'score':
                # A restrained evolving drone; the context chooses its tonal center.
                value += .12 * math.sin(2 * math.pi * base * t) + .07 * math.sin(2 * math.pi * base * 1.5 * t)
            fade = min(1, t / 2, (seconds - t) / 2)
            block.extend(struct.pack('<h', int(max(-1, min(1, value * fade)) * 20000)))
        yield bytes(block)


def ambience(folder, mode='ambience', direction='', seconds=60):
    """Record a local cue; play it with wav_stream. No provider calls or charges."""
    if mode == 'song':
        raise ValueError('Songs need a Vultr music model')
    cue = plan(folder, mode, direction)
    check_seconds(seconds)
    ident = hashlib.sha256(json.dumps([cue, seconds]).encode()).hexdigest()[:24]
    save(Path(folder) / 'soundtracks' / (ident + '.json'), {'id': ident, 'cue': cue, 'seconds': seconds, 'engine': 'local-procedural'})
    return ident, cue


def models():
    return request_json(vultr.BASE + '/music/models', headers=vultr.headers(), timeout=60)['data']


def create(folder, mode, model, seconds, direction='', lyrics=''):
    """Start a Vultr music job for a score or song. This can incur provider charges."""
    if mode == 'ambience':
        raise ValueError('Use local ambience for environmental soundtracks')
    cue = plan(folder, mode, direction)
    check_seconds(seconds)
    spec = next((m for m in models() if m.get('id') == model), None)
    if spec is None:
        raise ValueError('Select an available Vultr music model')
    prompt = cue['prompt']
    if mode == 'score':
        # Section tags satisfy the model's lyrics field without supplying sung words.
        lyrics, prompt = SCORE_LYRICS, SCORE_PROMPT + prompt
    if spec.get('lyrics') == 'required' and not lyrics.strip():
        raise ValueError('This model requires lyrics. Supply lyrics or choose local ambience')
    limits = spec.get('duration', {})
    if not limits.get('min', 1) <= seconds <= limits.get('max', 360):
        raise ValueError('Duration outside the selected model limits')
    job = request_json(vultr.BASE + '/music', {'model': model, 'prompt': prompt[:spec.get('prompt_max_length', 6000)],
                       'duration': seconds, 'lyrics': lyrics, 'response_format': 'mp3'}, headers=vultr.headers(), timeout=60)
    if not JOB_ID.fullmatch(str(job.get('id', ''))):
        raise ProviderError('Vultr returned an invalid music job')
    save(Path(folder) / 'soundtracks' / (job['id'] + '.json'), {'id': job['id'], 'cue': cue, 'job': job, 'model': model})
    return job, cue


def job_id(ident):
    if not JOB_ID.fullmatch(str(ident)):
        raise ValueError('Invalid music job')
    return ident


def status(ident):
    return request_json(vultr.BASE + '/music/' + job_id(ident), headers=vultr.headers(), timeout=60)


def audio(ident, action='content'):
    """Open the provider's audio response for streaming. The caller closes it."""
    if action not in ('stream', 'content'):
        raise ValueError('Choose stream or content')
    request = Request(vultr.BASE + '/music/' + job_id(ident) + '/' + action, headers=vultr.headers())
    try:
        return build_opener(NoRedirect()).open(request, timeout=60)
    except HTTPError as exc:
        code = exc.code
        exc.close()
        raise ProviderError(f'Vultr returned HTTP {code}; check the inference key, model access and job state') from None
    except (URLError, TimeoutError, OSError):
        raise ProviderError('Cannot reach Vultr inference') from None


def download(ident, path):
    total = 0
    with audio(ident) as response, open(path, 'wb') as out:
        while block := response.read(65536):
            total += len(block)
            if total > MAX_AUDIO_BYTES:
                raise ProviderError('The audio exceeded the size limit')
            out.write(block)
    return total


def discover_stories(root):
    """Find exported or active runs without selecting fixture or example data."""
    root = Path(root).resolve()
    markers = ('request.json', 'story.txt', 'FINAL_STORY.txt', 'PROVISIONAL_STORY.txt', 'PARTIAL_DRAFT.txt')
    found = {root} if any((root / name).is_file() for name in markers) else set()
    for parent in (root / 'outputs', root / 'runs'):
        if parent.is_dir():
            found.update(p for p in parent.iterdir() if p.is_dir() and any((p / name).is_file() for name in markers))
    return sorted(found)


def main():
    parser = argparse.ArgumentParser(description='Plan story soundtracks, render local soundscapes and create Vultr music')
    parser.add_argument('--folder', required=True, type=Path, help='Story run folder')
    sub = parser.add_subparsers(dest='action', required=True)
    cue = sub.add_parser('plan', help='Show the cue built from the story; no provider calls')
    local = sub.add_parser('ambience', help='Write a local WAV soundscape or drone score; no provider calls')
    local.add_argument('--out', required=True, type=Path)
    music = sub.add_parser('create', help='Start a Vultr score or song job (may incur charges)')
    music.add_argument('--model', required=True)
    music.add_argument('--lyrics', default='')
    for command in (cue, local, music):
        command.add_argument('--mode', choices=MODES, default='ambience' if command is not music else 'score')
        command.add_argument('--direction', default='')
        command.add_argument('--seconds', type=int, default=60)
    sub.add_parser('models', help='List Vultr music models')
    check = sub.add_parser('status', help='Show a Vultr music job')
    check.add_argument('job')
    fetch = sub.add_parser('download', help='Save a finished Vultr track')
    fetch.add_argument('job')
    fetch.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    if args.action == 'plan':
        result = plan(args.folder, args.mode, args.direction)
    elif args.action == 'ambience':
        ident, value = ambience(args.folder, args.mode, args.direction, args.seconds)
        with open(args.out, 'wb') as out:
            for block in wav_stream(value, args.seconds):
                out.write(block)
        result = {'id': ident, 'file': str(args.out), 'cue': value}
    elif args.action == 'create':
        job, value = create(args.folder, args.mode, args.model, args.seconds, args.direction, args.lyrics)
        result = {'job': job, 'cue': value}
    elif args.action == 'models':
        result = {'models': models()}
    elif args.action == 'status':
        result = status(args.job)
    else:
        result = {'file': str(args.out), 'bytes': download(args.job, args.out)}
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
