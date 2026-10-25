import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error


AVAILABLE = all(importlib.util.find_spec(name) for name in ('numpy', 'dotenv'))


def vector(axis=0):
    result = [0.0] * 768
    result[axis] = 1.0
    return result


@unittest.skipUnless(AVAILABLE, 'Install paramyth[rag] for hybrid retrieval tests')
class RAGTests(unittest.TestCase):
    def setUp(self):
        from paramyth.rag.settings import Settings
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'corpus.db'
        self.settings = Settings(str(self.path))
        self.corpus = {'title': 'Tests', 'records': [
            {'id': 'a', 'title': 'Harbor bell', 'text': 'A keeper protects a secret refuge.',
             'location': 'Coast', 'record_type': 'story', 'collection': 'Harbor'},
            {'id': 'b', 'title': 'Winter bridge', 'text': 'Builders cooperate before the snow.',
             'location': 'Mountain', 'record_type': 'scene', 'collection': 'Winter'},
            {'id': 'c', 'title': 'Bell tower', 'text': 'A watch keeps the harbor safe.',
             'location': 'Coast', 'record_type': 'scene', 'collection': 'Harbor',
             'retrieval': {'canonical_id': 'a'}},
        ]}

    def ingest(self, corpus=None, **kwargs):
        from paramyth.rag.ingest import ingest
        return ingest(self.settings, corpus or self.corpus,
                      encoder=kwargs.pop('encoder', lambda texts: [vector() for _ in texts]), **kwargs)

    def test_ingest_resumes_and_updates_projection(self):
        result = self.ingest()
        self.assertEqual(result['embedded'], 3)
        with patch('paramyth.rag.ingest.encode_texts', side_effect=AssertionError('Unexpected API call')):
            from paramyth.rag.ingest import ingest
            self.assertEqual(ingest(self.settings, self.corpus)['embedded'], 0)
        changed = copy.deepcopy(self.corpus)
        changed['records'][0]['text'] = 'A bell sounds the warning.'
        result2 = self.ingest(changed)
        self.assertEqual(result2['embedded'], 1)
        self.assertNotEqual(result2['corpus_hash'], result['corpus_hash'])

    def test_failed_batch_blocks_search_and_can_resume(self):
        from paramyth.rag.db import DatabaseError, existing_record_ids, search
        calls = []
        def fail_second(texts):
            calls.append(texts)
            if len(calls) == 2:
                raise RuntimeError('Temporary outage')
            return [vector() for _ in texts]
        with self.assertRaises(RuntimeError):
            self.ingest(encoder=fail_second, batch_size=1)
        self.assertEqual(existing_record_ids(self.settings), {'a'})
        with patch('paramyth.rag.db.encode_query') as encoder:
            with self.assertRaisesRegex(DatabaseError, 'mismatch|incomplete'):
                search(self.settings, 'harbor')
            encoder.assert_not_called()
        self.assertEqual(self.ingest()['embedded'], 2)
        self.assertEqual(len(search(self.settings, 'bell', semantic_weight=0)), 2)

    def test_removed_and_disabled_records_do_not_leak(self):
        from paramyth.rag.db import search, get_corpus_stats
        self.ingest()
        changed = copy.deepcopy(self.corpus)
        changed['records'] = changed['records'][:2]
        changed['records'][0]['retrieval'] = {'enabled': False}
        result = self.ingest(changed)
        self.assertEqual(result['embedded'], 0)
        self.assertEqual(get_corpus_stats(self.settings).documents, 2)
        with patch('paramyth.rag.db.encode_query', return_value=vector()):
            self.assertEqual([hit.record_id for hit in search(self.settings, 'harbor')], ['b'])
        self.assertEqual(search(self.settings, 'bell', semantic_weight=0), [])

    def test_invalid_corpus_leaves_completed_index_unchanged(self):
        from paramyth.rag.db import connection, index_metadata
        result = self.ingest()
        invalid = copy.deepcopy(self.corpus)
        invalid['records'][1]['id'] = 'a'
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            self.ingest(invalid)
        with connection(self.settings, readonly=True) as conn:
            self.assertEqual(index_metadata(conn)['fingerprint'], result['corpus_hash'])
        for invalid in ({'records': []}, {'records': [{'id': [], 'title': 'Invalid'}]}):
            with self.assertRaises(ValueError):
                self.ingest(invalid)

    def test_search_validates_version_and_hash_before_network(self):
        from paramyth.rag.db import connection, DatabaseError, search
        self.ingest()
        with patch('paramyth.rag.db.encode_query') as encoder:
            with self.assertRaisesRegex(DatabaseError, 'fingerprint'):
                search(self.settings, 'harbor', expected_hash='wrong')
            with connection(self.settings) as conn:
                conn.execute("UPDATE rag_documents SET embedding_model='old'")
            with self.assertRaisesRegex(DatabaseError, 'version'):
                search(self.settings, 'harbor')
            encoder.assert_not_called()

    def test_missing_index_does_not_create_a_database(self):
        from paramyth.rag.db import DatabaseError, search
        with self.assertRaises(DatabaseError):
            search(self.settings, 'harbor')
        self.assertFalse(self.path.exists())

    def test_rank_fusion_filters_and_diversification(self):
        from paramyth.rag.db import search
        self.ingest(encoder=lambda texts: [vector(0), vector(1), vector(0)])
        with patch('paramyth.rag.db.encode_query', return_value=vector(1)):
            hits = search(self.settings, 'bell', semantic_weight=1)
            self.assertEqual(hits[0].record_id, 'b')
            hybrid = search(self.settings, 'bell!', semantic_weight=.2)
            self.assertEqual(hybrid[0].record_id, 'a')
            self.assertEqual(hybrid[0].keyword_rank, 1)
            filtered = search(self.settings, 'bell', record_types=['scene'], location='Coast')
            self.assertEqual([hit.record_id for hit in filtered], ['c'])
            self.assertEqual(search(self.settings, 'bell', record_types=['unknown']), [])
        with patch('paramyth.rag.db.encode_query', return_value=vector(0)):
            combined = search(self.settings, 'bell', adaptation_mode='Combinatory')
            focused = search(self.settings, 'bell', adaptation_mode='Focused adaptation')
        self.assertEqual([hit.record_id for hit in combined], ['a', 'b', 'c'])
        self.assertEqual([hit.record_id for hit in focused], ['a', 'c', 'b'])

    def test_keyword_weight_zero_avoids_api_and_ties_are_stable(self):
        from paramyth.rag.db import search
        self.ingest()
        with patch('paramyth.rag.db.encode_query', side_effect=AssertionError('Unexpected API call')):
            self.assertEqual([hit.record_id for hit in search(self.settings, 'bell!', semantic_weight=0)], ['a', 'c'])
            self.assertEqual(search(self.settings, '!!!', semantic_weight=0), [])
        with patch('paramyth.rag.db.encode_query', return_value=vector()):
            self.assertEqual([hit.record_id for hit in search(self.settings, 'nothing', semantic_weight=1)], ['a', 'b', 'c'])

    def test_invalid_parameters_and_vectors_fail(self):
        from paramyth.rag.db import normalized, search
        for values in ([0.0] * 768, [1.0], [float('nan')] * 768):
            with self.assertRaises(ValueError):
                normalized(values)
        for kwargs in ({'limit': 0}, {'limit': True}, {'semantic_weight': float('nan')},
                       {'semantic_weight': 2}, {'adaptation_mode': 'unknown'}):
            with self.assertRaises(ValueError):
                search(self.settings, 'bell', **kwargs)

    def test_query_and_document_embedding_tasks(self):
        from paramyth.rag.embeddings import encode_texts, encode_query
        calls = []
        def respond(body, key):
            calls.extend(body['requests'])
            return {'embeddings': [{'values': [2.0] + [0.0] * 767} for _ in body['requests']]}
        with patch('paramyth.rag.embeddings.api_key', return_value='test-key'), \
             patch('paramyth.rag.embeddings._post', side_effect=respond):
            self.assertEqual(encode_texts(['Document'])[0], vector())
            self.assertEqual(encode_query('Query'), vector())
        self.assertEqual([call['taskType'] for call in calls], ['RETRIEVAL_DOCUMENT', 'RETRIEVAL_QUERY'])
        self.assertTrue(all(call['outputDimensionality'] == 768 for call in calls))
        for response in ({'embeddings': []}, {'embeddings': [{'values': [0.0] * 768}]}):
            with patch('paramyth.rag.embeddings.api_key', return_value='test-key'), \
                 patch('paramyth.rag.embeddings._post', return_value=response):
                with self.assertRaises(ValueError):
                    encode_query('Invalid output')

    def test_embedding_batches_and_redacted_errors(self):
        from paramyth.rag.embeddings import _post, encode_texts
        sizes = []
        def respond(body, key):
            sizes.append(len(body['requests']))
            return {'embeddings': [{'values': vector()} for _ in body['requests']]}
        with patch('paramyth.rag.embeddings.api_key', return_value='test-key'), \
             patch('paramyth.rag.embeddings._post', side_effect=respond):
            self.assertEqual(len(encode_texts(['Text'] * 101)), 101)
        self.assertEqual(sizes, [100, 1])
        error = urllib.error.HTTPError('https://example.invalid', 401, 'private body', {}, None)
        with patch('urllib.request.urlopen', side_effect=error):
            with self.assertRaisesRegex(RuntimeError, '^Gemini embedding request failed: HTTP 401$'):
                _post({}, 'test-key')

    def test_coordinator_freezes_hybrid_sources_on_resume(self):
        from paramyth.coordinator import run
        result = self.ingest()
        request = json.loads(Path('example.json').read_text())
        request.update(retrieval_mode='hybrid', retrieval_index=str(self.path), corpus_hash=result['corpus_hash'])
        folder = Path(self.temp.name) / 'run'
        with patch('paramyth.rag.db.encode_query', return_value=vector()) as encoder:
            first = run(request, folder)
            self.assertEqual(encoder.call_count, 1)
        self.path.unlink()
        with patch('paramyth.rag.db.encode_query', side_effect=AssertionError('Unexpected API call')):
            resumed = run(request, folder)
        self.assertEqual(first['retrieval'], resumed['retrieval'])
        self.assertEqual(first['retrieval']['mode'], 'hybrid')
        self.assertEqual(first['retrieval']['corpus_hash'], result['corpus_hash'])

    def test_injected_retrieval_works_without_an_index(self):
        from paramyth.coordinator import run
        request = json.loads(Path('example.json').read_text())
        request['retrieval_mode'] = 'hybrid'
        packet = {'sources': [{'id': 'external', 'title': 'External'}]}
        state = run(request, Path(self.temp.name) / 'custom', retrieval=lambda req: packet)
        self.assertEqual(state['retrieval'], packet)

    def test_hybrid_mode_requires_an_index(self):
        from paramyth.contracts import ContractError
        from paramyth.coordinator import run
        request = json.loads(Path('example.json').read_text())
        request['retrieval_mode'] = 'hybrid'
        with self.assertRaisesRegex(ContractError, 'requires a retrieval_index'):
            run(request, Path(self.temp.name) / 'missing')


if __name__ == '__main__':
    unittest.main()
