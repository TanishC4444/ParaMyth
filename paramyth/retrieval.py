"""Versioned SQLite FTS5 retrieval over an explicitly supplied corpus."""
import hashlib
import json
from pathlib import Path
import re
import sqlite3
from .contracts import require

VERSION = 'paramyth-fts5-v1'


def fingerprint(sources):
    return hashlib.sha256(json.dumps(sources, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def build_index(path, sources):
    require(isinstance(sources, list) and bool(sources), 'Corpus must contain source objects')
    ids = []
    for source in sources:
        require(isinstance(source, dict), 'Invalid corpus source')
        require(all(isinstance(source.get(k), str) and source[k].strip() for k in ('id', 'title', 'text')), 'Source needs id, title and text')
        ids.append(source['id'])
    require(len(ids) == len(set(ids)), 'Duplicate source IDs')
    # Validate the entire corpus before replacing any rows; DDL/data changes share a transaction.
    db = sqlite3.connect(path)
    try:
        with db:
            db.execute('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
            db.execute('CREATE VIRTUAL TABLE IF NOT EXISTS sources USING fts5(id UNINDEXED, title, text)')
            db.execute('DELETE FROM sources')
            db.executemany('INSERT INTO sources VALUES (?, ?, ?)', [(s['id'], s['title'], s['text']) for s in sources])
            db.execute('DELETE FROM metadata')
            db.executemany('INSERT INTO metadata VALUES (?, ?)', [('version', VERSION), ('fingerprint', fingerprint(sources))])
    finally:
        db.close()
    return fingerprint(sources)


def retrieve(path, query, *, expected_hash=None, limit=3):
    require(type(limit) is int and 1 <= limit <= 10, 'Invalid retrieval limit')
    require(Path(path).is_file(), 'Retrieval index is missing; build it first')
    db = sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True)
    try:
        metadata = dict(db.execute('SELECT key, value FROM metadata'))
        require(metadata.get('version') == VERSION, 'Stale retrieval index version; rebuild it')
        if expected_hash:
            require(metadata.get('fingerprint') == expected_hash, 'Corpus fingerprint changed; rebuild the index')
        terms = re.findall(r'\w+', query, re.UNICODE)[:32]
        match = ' OR '.join('"' + term + '"' for term in terms)
        rows = db.execute('SELECT id, title, text, bm25(sources) FROM sources WHERE sources MATCH ? ORDER BY bm25(sources), id LIMIT ?', (match, limit)).fetchall() if terms else []
        return {'query': query, 'index_version': VERSION, 'corpus_hash': metadata['fingerprint'],
                'sources': [{'id': r[0], 'title': r[1], 'excerpt': r[2][:1800], 'score': r[3]} for r in rows]}
    finally:
        db.close()


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Build a retrieval index from a JSON array of source objects')
    parser.add_argument('--corpus', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    print(build_index(args.out, json.loads(args.corpus.read_text())))
