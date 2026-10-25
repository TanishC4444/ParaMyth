"""Versioned corpus storage and weighted reciprocal-rank hybrid search."""
from contextlib import contextmanager
from dataclasses import dataclass
import json
from pathlib import Path
import re
import sqlite3

import numpy as np

from .embeddings import encode_query
from .identity import EMBEDDING_DIMENSIONS, INDEX_VERSION


class DatabaseError(RuntimeError):
    pass


@dataclass(frozen=True)
class CorpusStats:
    documents: int
    with_location: int
    corpus_name: str | None


@dataclass(frozen=True)
class SearchResult:
    record_id: str
    title: str
    location: str | None
    record_type: str
    canonical_id: str
    score: float
    semantic_rank: int | None
    keyword_rank: int | None
    record: dict


@contextmanager
def connection(settings, *, readonly=False):
    path = Path(settings.database_path).resolve()
    try:
        if readonly:
            conn = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()
    except sqlite3.Error as exc:
        raise DatabaseError('Could not access the RAG index; ingest the corpus before searching') from exc


def initialize(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS rag_documents (
        record_id TEXT PRIMARY KEY, corpus_name TEXT NOT NULL, parent_id TEXT,
        canonical_id TEXT NOT NULL, record_type TEXT NOT NULL, title TEXT NOT NULL,
        location TEXT, enabled INTEGER NOT NULL, content TEXT NOT NULL,
        record TEXT NOT NULL, embedding TEXT NOT NULL, embedding_model TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)''')
    conn.execute('CREATE VIRTUAL TABLE IF NOT EXISTS rag_documents_fts USING fts5(record_id UNINDEXED, content)')
    conn.execute('CREATE TABLE IF NOT EXISTS rag_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)')


def normalized(vector):
    value = np.asarray(vector, dtype=np.float32)
    norm = np.linalg.norm(value)
    if value.shape != (EMBEDDING_DIMENSIONS,) or not np.isfinite(norm) or norm == 0:
        raise ValueError('Invalid embedding vector; rebuild the index')
    return value / norm


def upsert_documents(settings, documents):
    rows = list(documents)
    vectors = [normalized(row['embedding']).tolist() for row in rows]
    with connection(settings) as conn:
        initialize(conn)
        for row, vector in zip(rows, vectors, strict=True):
            fields = ('record_id', 'corpus_name', 'parent_id', 'canonical_id', 'record_type',
                      'title', 'location', 'enabled', 'content', 'record')
            values = [row[field] for field in fields] + [json.dumps(vector), INDEX_VERSION]
            conn.execute('''INSERT INTO rag_documents
                (record_id,corpus_name,parent_id,canonical_id,record_type,title,location,
                 enabled,content,record,embedding,embedding_model) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(record_id) DO UPDATE SET corpus_name=excluded.corpus_name,
                parent_id=excluded.parent_id,canonical_id=excluded.canonical_id,
                record_type=excluded.record_type,title=excluded.title,location=excluded.location,
                enabled=excluded.enabled,content=excluded.content,record=excluded.record,
                embedding=excluded.embedding,embedding_model=excluded.embedding_model,
                updated_at=CURRENT_TIMESTAMP''', values)
            conn.execute('DELETE FROM rag_documents_fts WHERE record_id=?', (row['record_id'],))
            conn.execute('INSERT INTO rag_documents_fts VALUES (?,?)', (row['record_id'], row['content']))
        # Only a completed ingestion may declare the corpus ready for queries.
        conn.execute("DELETE FROM rag_metadata WHERE key='fingerprint'")
    return len(rows)


def indexed_contents(settings):
    with connection(settings) as conn:
        initialize(conn)
        return dict(conn.execute('SELECT record_id,content FROM rag_documents WHERE embedding_model=?', (INDEX_VERSION,)))


def existing_record_ids(settings):
    return set(indexed_contents(settings))


def get_corpus_stats(settings):
    with connection(settings, readonly=True) as conn:
        return CorpusStats(*conn.execute('SELECT count(*),count(location),max(corpus_name) FROM rag_documents').fetchone())


def index_metadata(conn, expected_hash=None):
    metadata = dict(conn.execute('SELECT key,value FROM rag_metadata'))
    versions = {row[0] for row in conn.execute('SELECT DISTINCT embedding_model FROM rag_documents')}
    if metadata.get('version') != INDEX_VERSION or versions != {INDEX_VERSION}:
        raise DatabaseError('Index encoder version mismatch; ingest the corpus again')
    if not metadata.get('fingerprint'):
        raise DatabaseError('Index is incomplete; resume corpus ingestion before searching')
    if expected_hash and metadata['fingerprint'] != expected_hash:
        raise DatabaseError('Corpus fingerprint changed; rebuild the index or update the request')
    return metadata


def search(settings, query, limit=3, semantic_weight=.65, record_types=None,
           location=None, adaptation_mode='Balanced', *, expected_hash=None):
    if not isinstance(query, str) or not query.strip():
        raise ValueError('Search query must be a nonempty string')
    if type(limit) is not int or not 1 <= limit <= 60:
        raise ValueError('Choose between 1 and 60 results')
    if type(semantic_weight) not in (int, float) or not 0 <= semantic_weight <= 1:
        raise ValueError('Semantic weight must be between 0 and 1')
    if adaptation_mode not in {'Balanced', 'Focused adaptation', 'Combinatory'}:
        raise ValueError('Unknown adaptation mode')
    with connection(settings, readonly=True) as conn:
        index_metadata(conn, expected_hash)
        sql = 'SELECT * FROM rag_documents WHERE enabled=1'
        params = []
        if record_types:
            sql += ' AND record_type IN (' + ','.join('?' for _ in record_types) + ')'
            params.extend(record_types)
        if location:
            sql += ' AND location LIKE ?'
            params.append('%' + location + '%')
        rows = conn.execute(sql + ' ORDER BY record_id', params).fetchall()
        if not rows:
            return []
        allowed = {row['record_id'] for row in rows}
        terms = re.findall(r'\w+', query, re.UNICODE)[:32]
        expression = ' OR '.join('"' + term + '"' for term in terms)
        matches = conn.execute('''SELECT record_id FROM rag_documents_fts
            WHERE rag_documents_fts MATCH ? ORDER BY bm25(rag_documents_fts),record_id''',
            (expression,)).fetchall() if terms and semantic_weight < 1 else []
        keywords = {rid: i + 1 for i, rid in enumerate(
            [row['record_id'] for row in matches if row['record_id'] in allowed][:60])}
    semantic = {}
    if semantic_weight > 0:
        query_vector = normalized(encode_query(query))
        vectors = np.asarray([normalized(json.loads(row['embedding'])) for row in rows])
        similarities = vectors @ query_vector
        ordered = sorted(range(len(rows)), key=lambda i: (-float(similarities[i]), rows[i]['record_id']))[:60]
        semantic = {rows[i]['record_id']: rank + 1 for rank, i in enumerate(ordered)}
    by_id = {row['record_id']: row for row in rows}
    ranked = []
    for rid in set(semantic) | set(keywords):
        row = by_id[rid]
        sr, kr = semantic.get(rid), keywords.get(rid)
        score = (semantic_weight / (60 + sr) if sr else 0) + ((1 - semantic_weight) / (60 + kr) if kr else 0)
        ranked.append(SearchResult(rid, row['title'], row['location'], row['record_type'],
            row['canonical_id'], score, sr, kr, json.loads(row['record'])))
    ordered = sorted(ranked, key=lambda result: (-result.score, result.record_id))
    if adaptation_mode == 'Focused adaptation' and ordered:
        primary = ordered[0].canonical_id
        ordered.sort(key=lambda result: (result.canonical_id != primary, -result.score, result.record_id))
    if adaptation_mode == 'Combinatory':
        selected, canonical, collections = [], set(), set()
        for result in ordered:
            collection = str(result.record.get('collection') or result.canonical_id).casefold()
            if result.canonical_id in canonical or collection in collections:
                continue
            selected.append(result)
            canonical.add(result.canonical_id)
            collections.add(collection)
        ordered = selected + [result for result in ordered if result not in selected]
    return ordered[:limit]
