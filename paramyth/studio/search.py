"""Literary search for the story atlas: keyword or hybrid matches mapped onto atlas stories."""
from functools import lru_cache
import json
import os
from pathlib import Path

from fastapi import APIRouter, Body, HTTPException

from .deps import LOCAL, WRITE

router = APIRouter(prefix='/api/ui', tags=['literary search'], dependencies=LOCAL)
ATLAS = Path(__file__).resolve().parents[2] / 'frontend' / 'public' / 'atlas' / 'stories.json'
SEMANTIC_WEIGHT = .95  # Idea search leans on meaning and keeps a small exact-word signal.


@lru_cache(maxsize=1)
def atlas_anchors():
    """Map every corpus record, including episodes, to the atlas story that shows it."""
    try:
        stories = json.loads(ATLAS.read_text(encoding='utf-8'))['stories']
    except (OSError, ValueError, KeyError):
        return {}
    anchors = {}
    for story in stories:
        anchors[story['id']] = story['id']
        for child in story.get('children') or []:
            anchors[child['id'] if isinstance(child, dict) else child] = story['id']
    return anchors


def semantic_ready():
    try:
        from ..rag.embeddings import api_key
        api_key()
        return True
    except (ImportError, RuntimeError):
        return False


@router.post('/search')
def search(data: dict = Body(...)):
    query = str(data.get('query', '')).strip()
    if not 1 <= len(query) <= 2000:
        raise ValueError('Describe your idea in 1–2,000 characters')
    mode = data.get('mode', 'lexical')
    if mode not in ('lexical', 'hybrid'):
        raise ValueError('Choose keyword or semantic search')
    limit = data.get('limit', 8)
    if type(limit) is not int or not 1 <= limit <= 20:
        raise ValueError('Choose between 1 and 20 literary matches')
    if mode == 'hybrid' and not semantic_ready():
        raise HTTPException(503, 'Semantic search needs a Gemini embedding key. Add it in Connections, or choose Story keywords.')
    try:
        from ..rag.db import DatabaseError
        from ..rag.search import retrieve
        from ..rag.settings import Settings
    except ImportError:
        raise HTTPException(503, "Literary search isn't installed. Install the rag extra to search the corpus.") from None
    try:
        result = retrieve(Settings.from_environment().database_path, query, limit=limit,
                          semantic_weight=SEMANTIC_WEIGHT if mode == 'hybrid' else 0)
    except DatabaseError:
        raise HTTPException(503, 'The literary index is missing or out of date. Build it with paramyth.rag.ingest, then search again.') from None
    except RuntimeError:
        raise HTTPException(503, 'The literary search service is unavailable. Check the Gemini key in Connections and try again.') from None
    anchors = atlas_anchors()
    return {**result, 'mode': mode, 'sources': [{**s, 'atlas_id': anchors.get(s['id'])} for s in result['sources']]}


@router.get('/retrieval-connection')
def retrieval_connection():
    return {'semantic': semantic_ready(), 'keyword': True}


@router.post('/retrieval-connection', dependencies=WRITE)
def set_retrieval_connection(data: dict = Body(...)):
    key = data.get('key')
    if not isinstance(key, str) or not 10 <= len(key.strip()) <= 500:
        raise ValueError('Enter the Gemini embedding API key')
    # Held in server memory for this session only; never written to disk.
    os.environ['GEMINI_API_KEY'] = key.strip()
    return {'semantic': semantic_ready(), 'keyword': True}
