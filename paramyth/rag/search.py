"""Return hybrid results in the same source packet used by the story coordinator."""
import argparse
import json
from pathlib import Path

from .db import connection, index_metadata, search
from .documents import document_text
from .settings import Settings


def retrieve(path, query, *, expected_hash=None, limit=3, semantic_weight=.65,
             record_types=None, location=None, adaptation_mode='Balanced'):
    settings = Settings(str(path))
    with connection(settings, readonly=True) as conn:
        metadata = index_metadata(conn, expected_hash)
    matches = search(settings, query, limit, semantic_weight, record_types, location,
                     adaptation_mode, expected_hash=metadata['fingerprint'])
    return {'query': query, 'mode': 'hybrid', 'index_version': metadata['version'],
            'corpus_hash': metadata['fingerprint'], 'sources': [
                {'id': item.record_id, 'title': item.title,
                 'excerpt': document_text(item.record)[:1800], 'score': item.score,
                 'canonical_id': item.canonical_id, 'semantic_rank': item.semantic_rank,
                 'keyword_rank': item.keyword_rank,
                 'limits': item.record.get('references', {}).get('version_notes')}
                for item in matches]}


def main():
    parser = argparse.ArgumentParser(description='Search a hybrid retrieval index')
    parser.add_argument('query')
    parser.add_argument('--index', type=Path)
    parser.add_argument('--limit', type=int, default=3)
    parser.add_argument('--semantic-weight', type=float, default=.65)
    parser.add_argument('--corpus-hash')
    parser.add_argument('--record-type', action='append')
    parser.add_argument('--location')
    parser.add_argument('--adaptation-mode', choices=['Balanced', 'Focused adaptation', 'Combinatory'], default='Balanced')
    args = parser.parse_args()
    path = args.index or Settings.from_environment().database_path
    print(json.dumps(retrieve(path, args.query, limit=args.limit,
        semantic_weight=args.semantic_weight, expected_hash=args.corpus_hash,
        record_types=args.record_type, location=args.location, adaptation_mode=args.adaptation_mode), indent=2))


if __name__ == '__main__':
    main()
