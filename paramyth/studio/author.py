"""Editable author projects: validate them, read them from run folders and export run requests."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import re

from ..storage import load

MEDIA = {'book': 'Novel', 'novel': 'Novel', 'short_story': 'Short story', 'stage_play': 'Stage play',
         'screenplay': 'Screenplay', 'audio_drama': 'Audio drama', 'comic_script': 'Comic script'}
SCENE_STATES = ('Draft', 'Provisional', 'In review', 'Accepted')
FACT_KINDS = ('Event', 'Belief', 'Claim', 'Resource', 'Relationship', 'Thread')
REVIEWS = (('review', 'Story'), ('rhetoric_review', 'Rhetoric'), ('memory_review', 'Memory'))


def validate_project(p):
    def require(ok, message):
        if not ok:
            raise ValueError(message)

    def text(obj, keys):
        require(isinstance(obj, dict), 'Expected an object')
        require(all(isinstance(obj.get(k), str) for k in keys), 'Expected text fields: ' + ', '.join(keys))

    def rows(obj, key):
        value = obj.get(key, [])
        require(isinstance(value, list) and len(value) <= 2000, 'Invalid ' + key)
        return value
    require(isinstance(p, dict), 'Supply a project object')
    require(len(json.dumps(p)) <= 5_000_000, 'Project exceeds 5 MB')
    text(p, ['title'])
    require(0 < len(p['title'].strip()) <= 150, 'Title must contain 1–150 characters')
    b = p.get('brief')
    text(b, ['premise', 'medium', 'genre', 'tone', 'pov'])
    require(b['medium'] in set(MEDIA.values()), 'Unsupported medium')
    for k in ('themes', 'worldRules', 'mustAvoid'):
        require(all(isinstance(x, str) for x in rows(b, k)), 'Invalid ' + k)
    for k, maximum in [('chapters', 100), ('scenesPerChapter', 100), ('wordMin', 20000), ('wordMax', 20000)]:
        require(type(b.get(k)) is int and 1 <= b[k] <= maximum, 'Invalid ' + k)
    require(b['wordMax'] >= b['wordMin'], 'Maximum length must be at least the minimum')
    for c in rows(b, 'characters'):
        text(c, ['id', 'name', 'goal', 'fear', 'voice'])
        text(c.get('arc'), ['belief', 'pressure', 'choice', 'change'])
    for s in rows(p, 'scenes'):
        text(s, ['id', 'title', 'pov', 'location', 'content'])
        require(s.get('state') in SCENE_STATES, 'Invalid scene state')
        require(type(s.get('chapter')) is int and s['chapter'] > 0, 'Invalid scene chapter')
        require(type(s.get('minutes')) in (int, float) and s['minutes'] >= 0, 'Invalid scene timing')
        require(type(s.get('night')) is bool, 'Invalid scene lighting')
        for f in rows(s, 'findings'):
            text(f, ['id', 'dimension', 'severity', 'quote', 'note', 'status', 'source'])
    for f in rows(p, 'canon'):
        text(f, ['id', 'kind', 'text', 'sceneId', 'state'])
        require(all(isinstance(h, str) for h in rows(f, 'holders')), 'Invalid knowledge holders')
    for v in rows(p, 'versions'):
        text(v, ['id', 'label', 'created'])
        rows(v, 'scenes')
    for values in (b.get('characters', []), p.get('scenes', []), p.get('canon', [])):
        require(len({v['id'] for v in values}) == len(values), 'Duplicate record IDs')
    return p


def read(path, default):
    try:
        return load(path) if path.is_file() else default
    except (ValueError, OSError):
        return default


def revision(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else 'new'


def findings(scene):
    result = []
    for key, dimension in REVIEWS:
        review = scene.get(key, {})
        if not isinstance(review, dict):
            continue
        for i, issue in enumerate(review.get('issues', [])):
            if isinstance(issue, dict):
                result.append({'id': f'{key}-{i}', 'dimension': dimension, 'severity': 'Blocking' if issue.get('severity') == 'blocking' else 'Minor',
                               'quote': str(issue.get('quote', '')), 'note': f"{issue.get('problem', '')} {issue.get('fix', '')}".strip(),
                               'status': 'Open', 'source': 'Reviewer'})
    return result


def canon_facts(state):
    """Current facts only: superseded records stay in the run's history, not the editor."""
    history = state.get('memories', [])
    history = history if isinstance(history, list) else []
    replaced = {old for r in history if isinstance(r, dict) for old in r.get('supersedes', [])}
    result = []
    for i, f in enumerate(history):
        if not isinstance(f, dict) or f.get('id') in replaced:
            continue
        kind = str(f.get('kind', 'event')).capitalize()
        result.append({'id': str(f.get('id', f'fact-{i}')), 'kind': kind if kind in FACT_KINDS else 'Event',
                       'text': str(f.get('text', '')), 'holders': [str(h) for h in f.get('known_by', ['public'])],
                       'sceneId': str(f.get('scene_id', f.get('source', ''))), 'state': 'Accepted'})
    return result


def project(root, ident, workspace):
    """Read the author's saved project, or build one from the run's request and accepted scenes."""
    edited = root / 'author-workspace.json'
    if edited.exists():
        return {**load(edited), 'revision': revision(edited)}
    req, state = read(root / 'request.json', {}), read(root / 'state.json', {})
    if state.get('backend') == 'fixture':
        return None
    title = req.get('title') or root.name
    scenes = []
    for i, s in enumerate(state.get('accepted', [])):
        if not isinstance(s, dict):
            continue
        text = s.get('prose', '')
        scenes.append({'id': s.get('id', f'scene-{i + 1}'), 'chapter': s.get('chapter', 1), 'title': s.get('title', s.get('id', f'Scene {i + 1}')),
                       'pov': s.get('pov', ''), 'location': s.get('location', ''), 'content': text, 'state': 'Accepted',
                       'findings': findings(s), 'minutes': max(1, len(text.split()) // 150), 'night': False})
    if not scenes:
        source = next((root / n for n in ('FINAL_STORY.txt', 'PROVISIONAL_STORY.txt', 'PARTIAL_DRAFT.txt', 'story.txt') if (root / n).is_file()), None)
        if source:
            text = source.read_text(encoding='utf-8-sig')
            if text.startswith('FIXTURE /'):
                return None
            if not req:
                title = text.splitlines()[0][:150]
            scenes = [{'id': 'manuscript', 'chapter': 1, 'title': 'Manuscript', 'pov': '', 'location': '', 'content': text,
                       'state': 'Draft', 'findings': [], 'minutes': max(1, len(text.split()) // 150), 'night': False}]
    characters = []
    for i, c in enumerate(req.get('characters', [])):
        arc = c.get('arc', {})
        characters.append({'id': c.get('id', f'character-{i}'), 'name': c.get('name', ''), 'goal': c.get('goal', ''), 'fear': c.get('fear', ''),
                           'voice': c.get('voice', ''), 'arc': {'belief': arc.get('starting_belief', ''), 'pressure': arc.get('pressure_test', ''),
                                                                 'choice': arc.get('costly_choice', ''), 'change': arc.get('possible_change', '')}})
    words = req.get('words_per_scene', 850)
    low, high = round(words * req.get('min_words_ratio', .75)), round(words * req.get('max_words_ratio', 1.3))
    brief = {'premise': req.get('premise', ''), 'medium': MEDIA.get(req.get('medium'), 'Novel'), 'genre': str(req.get('genre', '')),
             'tone': str(req.get('tone_mood', '')), 'pov': str(req.get('pov', '')), 'themes': req.get('theme_keywords', []),
             'worldRules': req.get('world_rules', []), 'mustAvoid': req.get('must_avoid', []), 'chapters': req.get('chapters', 1),
             'scenesPerChapter': req.get('scenes_per_chapter', 1), 'wordMin': low, 'wordMax': max(low, high), 'lengthMode': 'Guided',
             'characters': characters}
    return {'id': ident, 'title': title, 'owner': 'Your workspace', 'color': 'mint',
            'updated': datetime.fromtimestamp(root.stat().st_mtime, timezone.utc).isoformat(), 'brief': brief, 'scenes': scenes,
            'canon': canon_facts(state), 'versions': [], 'revision': 'new', 'folder': root.relative_to(workspace).as_posix(), 'imported': True}


def export_request(p, previous):
    """Map the author's brief onto a run request, keeping fields the editor doesn't show."""
    b, r = p['brief'], deepcopy(previous)
    words = max(100, min(1200, round((b['wordMin'] + b['wordMax']) / 2)))
    r.update(title=p['title'], premise=b['premise'], medium=next((k for k, v in MEDIA.items() if v == b['medium']), 'novel'),
             genre=b['genre'], tone_mood=b['tone'], pov=b['pov'], theme_keywords=b['themes'], world_rules=b['worldRules'],
             must_avoid=b['mustAvoid'], chapters=b['chapters'], scenes_per_chapter=b['scenesPerChapter'], words_per_scene=words,
             min_words_ratio=round(b['wordMin'] / words, 3), max_words_ratio=round(b['wordMax'] / words, 3))
    r.setdefault('project_id', re.sub('[^A-Za-z0-9_-]', '-', p.get('id') or p['title'])[:64] or 'story')
    original = {c['id']: c for c in previous.get('characters', []) if 'id' in c}
    r['characters'] = [{**original.get(c['id'], {}), 'id': c['id'], 'name': c['name'], 'goal': c['goal'], 'fear': c['fear'], 'voice': c['voice'],
                        'arc': {**original.get(c['id'], {}).get('arc', {}), 'starting_belief': c['arc']['belief'], 'pressure_test': c['arc']['pressure'],
                                'costly_choice': c['arc']['choice'], 'possible_change': c['arc']['change']}} for c in b['characters']]
    return r
