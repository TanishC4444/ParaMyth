"""Story atlas: corpus works placed on a world map, read from the literary RAG database.

Map anchors live in data/atlas-places.json rather than the database's location
column, because that column is part of the embedded document text and changing it
would make the bundled retrieval projections stale.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
from functools import lru_cache
from pathlib import Path
from ..paths import workspace_root
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

ROOT = workspace_root()
PLACES = ROOT / 'data' / 'atlas-places.json'

router = APIRouter(prefix='/api/v1/atlas', tags=['atlas'])


class AtlasEpisode(BaseModel):
    id: str
    title: str
    record_type: str
    analysis: str
    instruction: str
    mechanism: str
    summary: str | None = None


class AtlasPin(BaseModel):
    id: str
    title: str
    tradition: str
    section: str
    attribution: str
    region: str
    place: str
    basis: Literal['origin', 'setting']
    lat: float
    lng: float
    mechanism: str
    themes: list[str]
    teaser: str
    detailed: bool
    episodes: int


class AtlasStory(AtlasPin):
    analysis: str
    instruction: str
    techniques: list[str]
    keywords: list[str]
    summary: str | None = None
    genre: list[str] = []
    tone: str | None = None
    key_ideas: list[str] = []
    characters: list[str] = []
    context: str | None = None
    threads: list[str] = []
    sensory: list[str] = []
    adaptability: str | None = None
    version_notes: str | None = None
    notes: list[str] = []
    verification: str
    children: list[AtlasEpisode] = []


class AtlasIndex(BaseModel):
    corpus: str
    regions: list[str]
    stories: list[AtlasPin]


def database_path() -> Path:
    # Same resolution as paramyth.pipeline.rag.settings, without its side effects (dotenv, mkdir).
    path = Path(os.environ.get('DATABASE_PATH', 'data/literary_rag.db'))
    return path if path.is_absolute() else ROOT / path


def _clean(label: str) -> str:
    """'1. Brothers Grimm Collection (…)' -> 'Brothers Grimm Collection (…)'; 'II. Classical …' -> 'Classical …'."""
    return re.sub(r'^(?:\d+|[IVX]+)\.\s*', '', label).strip()


def _teaser(text: str, limit: int = 200) -> str:
    first = re.split(r'(?<=[.!?])\s', text.strip(), maxsplit=1)[0]
    return first if len(first) <= limit else first[:limit - 1].rsplit(' ', 1)[0] + '…'


def _episode(r: dict) -> AtlasEpisode:
    return AtlasEpisode(id=r['id'], title=r['title'], record_type=r['record_type'], analysis=r['literary_analysis'],
                        instruction=r['prompt_refinement']['instruction'], mechanism=r['narrative_mechanism'],
                        summary=r.get('summary'))


def _story(r: dict, place: dict, children: list[dict]) -> AtlasStory:
    summary = r.get('summary')
    return AtlasStory(
        id=r['id'], title=r['title'], tradition=_clean(r['collection']), section=_clean(r['section']),
        attribution=r['attribution'], region=place['region'], place=place['place'], basis=place['basis'],
        lat=place['lat'], lng=place['lng'], mechanism=r['narrative_mechanism'], themes=r['themes'],
        teaser=_teaser(summary or r['literary_analysis']), detailed=bool(summary), episodes=len(children),
        analysis=r['literary_analysis'], instruction=r['prompt_refinement']['instruction'],
        techniques=r['literary_techniques'], keywords=r['theme_keywords'], summary=summary,
        genre=r.get('genre') or [], tone=r.get('tone_mood'), key_ideas=r.get('key_ideas') or [],
        characters=r.get('main_characters') or [], context=(r.get('plot') or {}).get('context'),
        threads=(r.get('subplots') or {}).get('threads') or [],
        sensory=(r.get('detail_and_sensory') or {}).get('documented_cues') or [],
        adaptability=r.get('adaptability'), version_notes=(r.get('references') or {}).get('version_notes'),
        notes=r.get('notes') or [], verification=r['provenance']['verification_status'],
        children=[_episode(c) for c in children],
    )


@lru_cache
def _load(db: str, places_file: str) -> tuple[str, tuple[AtlasStory, ...]]:
    places = json.loads(Path(places_file).read_text(encoding='utf-8'))['places']
    conn = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
    try:
        rows = conn.execute('SELECT record_id, parent_id, enabled, record, corpus_name FROM rag_documents').fetchall()
    finally:
        conn.close()
    records = {rid: json.loads(record) for rid, _, _, record, _ in rows}
    enabled = {rid for rid, _, on, _, _ in rows if on}
    children: dict[str, list[dict]] = {}
    for rid, parent, _, _, _ in rows:
        if parent and rid in enabled:
            children.setdefault(parent, []).append(records[rid])
    stories = tuple(
        _story(records[rid], places[rid], sorted(children.get(rid, []), key=lambda c: c['id']))
        for rid in sorted(places) if rid in enabled and not records[rid].get('parent_id')
    )
    return (rows[0][4] if rows else ''), stories


def load_stories() -> tuple[str, tuple[AtlasStory, ...]]:
    db = database_path()
    if not db.is_file():
        raise HTTPException(503, f'Literary database not found at {db.name}')
    return _load(str(db), str(PLACES))


def index() -> AtlasIndex:
    corpus, stories = load_stories()
    pins = [AtlasPin(**s.model_dump(include=set(AtlasPin.model_fields))) for s in stories]
    return AtlasIndex(corpus=corpus, regions=sorted({s.region for s in stories}), stories=pins)


@router.get('/stories', response_model=AtlasIndex)
def list_stories():
    """Every mapped work with its anchor and a one-line teaser. Public corpus data; no token required."""
    return index()


@router.get('/stories/{record_id}', response_model=AtlasStory)
def get_story(record_id: str):
    """Full description of one work, including its episodes, from the literary database."""
    for story in load_stories()[1]:
        if story.id == record_id:
            return story
    raise HTTPException(404, f'No mapped story {record_id}')
