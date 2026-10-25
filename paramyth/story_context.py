"""Read an allowlist of story artifacts for media prompts."""
import json
from pathlib import Path


def context(folder):
    """Read only narrative artifacts; never sweep logs, environment or credentials."""
    root = Path(folder)
    sources = []
    candidates = [root / name for name in ('request.json', 'state.json', 'story.txt', 'FINAL_STORY.txt', 'PROVISIONAL_STORY.txt', 'PARTIAL_DRAFT.txt', 'characters.json', 'world.json', 'memory.json', 'plan.json')]
    if (root/'author-draft.txt').is_file():
        candidates=[root/'author-draft.txt',root/'request.json',root/'characters.json',root/'world.json']
    candidates += sorted((root / 'scenes').glob('*.txt'))
    for path in candidates:
        if path.is_file():
            value = path.read_text(encoding='utf-8')
            if path.suffix == '.json':
                obj = json.loads(value)
                # State contains accepted writing, canon and memories, not provider logs.
                if path.name == 'state.json':
                    obj = {k: obj[k] for k in ('accepted', 'memories', 'plan', 'canon') if k in obj}
                if path.name == 'request.json':
                    obj = {k: obj[k] for k in ('title', 'premise', 'genre', 'tone_mood', 'characters', 'world_rules', 'initial_facts', 'locations', 'scene_seeds', 'chapter_arcs', 'sensory_detail') if k in obj}
                value = json.dumps(obj, ensure_ascii=False)
            sources.append({'file': str(path.relative_to(root)), 'text': value})
    if not sources:
        raise ValueError('No story artifacts found. Select a story run folder containing request.json or story.txt.')
    return sources
