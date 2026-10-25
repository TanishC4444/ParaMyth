"""Resume corpus embedding in batches and publish a complete index fingerprint."""
import argparse
import json
from pathlib import Path

from ..retrieval import fingerprint
from .db import connection, initialize, indexed_contents, upsert_documents
from .documents import document_text, location_text
from .embeddings import encode_texts
from .identity import INDEX_VERSION
from .settings import Settings


def validate_corpus(corpus):
    records = corpus.get('records') if isinstance(corpus, dict) else corpus
    if not isinstance(records, list) or not records:
        raise ValueError('Expected a nonempty records array')
    for record in records:
        if not isinstance(record, dict) or any(
            not isinstance(record.get(key), str) or not record[key].strip() for key in ('id', 'title')
        ):
            raise ValueError('Every record needs a nonempty string ID and title')
        for key in ('plot', 'subplots', 'detail_and_sensory', 'references', 'retrieval'):
            if key in record and not isinstance(record[key], dict):
                raise ValueError(f'{key} must be an object')
        retrieval = record.get('retrieval', {})
        if type(retrieval.get('enabled', True)) is not bool:
            raise ValueError('Retrieval enabled must be boolean')
        canonical = retrieval.get('canonical_id', record['id'])
        if not isinstance(canonical, str) or not canonical.strip():
            raise ValueError('Canonical ID must be a nonempty string')
        if not isinstance(record.get('record_type', 'unknown'), str):
            raise ValueError('Record type must be a string')
        if record.get('parent_id') is not None and not isinstance(record['parent_id'], str):
            raise ValueError('Parent ID must be a string')
    if len({record['id'] for record in records}) != len(records):
        raise ValueError('Duplicate record IDs in the corpus')
    # Evaluate every projection before changing the current index.
    for record in records:
        document_text(record)
    return records


def ingest(settings, corpus, *, encoder=None, batch_size=32):
    records = validate_corpus(corpus)
    if type(batch_size) is not int or not 1 <= batch_size <= 100:
        raise ValueError('Batch size must be between 1 and 100')
    title = corpus.get('title', 'Untitled corpus') if isinstance(corpus, dict) else 'Untitled corpus'
    if not isinstance(title, str) or not title.strip():
        raise ValueError('Corpus title must be a nonempty string')
    digest = fingerprint(records)
    encoder = encoder or encode_texts
    existing = indexed_contents(settings)
    pending = [record for record in records if existing.get(record['id']) != document_text(record)]
    with connection(settings) as conn:
        initialize(conn)
        conn.execute("DELETE FROM rag_metadata WHERE key='fingerprint'")
    embedded = 0
    for start in range(0, len(pending), batch_size):
        batch = pending[start:start + batch_size]
        contents = [document_text(record) for record in batch]
        vectors = encoder(contents)
        if len(vectors) != len(batch):
            raise ValueError('Embedding model returned the wrong number of vectors')
        rows = []
        for record, content, vector in zip(batch, contents, vectors, strict=True):
            retrieval = record.get('retrieval', {})
            rows.append({
                'record_id': record['id'], 'corpus_name': title,
                'parent_id': record.get('parent_id'),
                'canonical_id': retrieval.get('canonical_id', record['id']),
                'record_type': record.get('record_type', 'unknown'), 'title': record['title'],
                'location': location_text(record.get('location')),
                'enabled': retrieval.get('enabled', True), 'content': content,
                'record': json.dumps(record, ensure_ascii=False), 'embedding': vector,
            })
        embedded += upsert_documents(settings, rows)
    with connection(settings) as conn:
        # Publish metadata changes and remove deleted records only when all batches succeeded.
        expected = {record['id'] for record in records}
        for row in conn.execute('SELECT record_id FROM rag_documents').fetchall():
            if row['record_id'] not in expected:
                conn.execute('DELETE FROM rag_documents WHERE record_id=?', (row['record_id'],))
                conn.execute('DELETE FROM rag_documents_fts WHERE record_id=?', (row['record_id'],))
        for record in records:
            retrieval = record.get('retrieval', {})
            conn.execute('''UPDATE rag_documents SET corpus_name=?,parent_id=?,canonical_id=?,
                record_type=?,title=?,location=?,enabled=?,record=? WHERE record_id=?''',
                (title, record.get('parent_id'), retrieval.get('canonical_id', record['id']),
                 record.get('record_type', 'unknown'), record['title'], location_text(record.get('location')),
                 retrieval.get('enabled', True), json.dumps(record, ensure_ascii=False), record['id']))
        conn.executemany('INSERT OR REPLACE INTO rag_metadata VALUES (?,?)',
                         [('version', INDEX_VERSION), ('fingerprint', digest)])
    return {'documents': len(records), 'embedded': embedded, 'corpus_hash': digest, 'index_version': INDEX_VERSION}


def main():
    parser = argparse.ArgumentParser(description='Build or resume a hybrid retrieval index')
    parser.add_argument('--corpus', required=True, type=Path)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    settings = Settings(str(args.out.resolve())) if args.out else Settings.from_environment()
    result = ingest(settings, json.loads(args.corpus.read_text(encoding='utf-8-sig')))
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
