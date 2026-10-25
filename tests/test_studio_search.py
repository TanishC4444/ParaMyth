"""Literary search routes: keyword and hybrid matches mapped onto atlas stories."""
import importlib.util
import os
import unittest
from unittest.mock import patch

from test_studio_projects import StudioTestCase

RAG = all(importlib.util.find_spec(name) for name in ('numpy', 'dotenv'))
CORPUS = {'title': 'Tests', 'records': [
    {'id': 'a', 'title': 'Harbor bell', 'text': 'A keeper protects a secret refuge by the harbor.', 'location': 'Coast', 'record_type': 'story'},
    {'id': 'b', 'title': 'Winter bridge', 'text': 'Builders cooperate before the snow.', 'location': 'Mountain', 'record_type': 'story'}]}


def vector(axis=0):
    value = [0.0] * 768
    value[axis] = 1.0
    return value


class SearchTests(StudioTestCase):
    def setUp(self):
        super().setUp()
        self.headers = {'X-ParaMyth-Token': self.token}
        self.env = patch.dict(os.environ, {'PARAMYTH_RAG_DATABASE': str(self.root / 'corpus.db'), 'GEMINI_API_KEY': '', 'GOOGLE_API_KEY': ''})
        self.env.start()
        self.addCleanup(self.env.stop)

    def build(self):
        from paramyth.rag.ingest import ingest
        from paramyth.rag.settings import Settings
        ingest(Settings(str(self.root / 'corpus.db')), CORPUS, encoder=lambda texts: [vector(i) for i, _ in enumerate(texts)])

    def search(self, **body):
        return self.client.post('/api/ui/search', json={'query': 'harbor keeper', **body})

    def test_bad_requests_are_rejected(self):
        for body in ({'query': ''}, {'mode': 'psychic'}, {'limit': 0}, {'limit': 21}):
            self.assertEqual(self.search(**body).status_code, 422)

    def test_hybrid_needs_a_key_and_reports_it(self):
        response = self.search(mode='hybrid')
        self.assertEqual(response.status_code, 503)
        self.assertIn('Gemini', response.json()['detail'])
        self.assertEqual(self.client.get('/api/ui/retrieval-connection').json(), {'semantic': False, 'keyword': True})

    @unittest.skipUnless(RAG, 'rag extra not installed')
    def test_missing_index_is_explained(self):
        response = self.search()
        self.assertEqual(response.status_code, 503)
        self.assertIn('paramyth.rag.ingest', response.json()['detail'])

    @unittest.skipUnless(RAG, 'rag extra not installed')
    def test_keyword_search_maps_matches_to_atlas_stories_without_calls(self):
        self.build()
        with patch('paramyth.studio.search.atlas_anchors', return_value={'a': 'work_001'}), \
                patch('paramyth.rag.db.encode_query', side_effect=AssertionError('no embedding call')):
            result = self.search(limit=5).json()
        self.assertEqual(result['mode'], 'lexical')
        self.assertEqual(result['sources'][0]['id'], 'a')
        self.assertEqual(result['sources'][0]['atlas_id'], 'work_001')

    @unittest.skipUnless(RAG, 'rag extra not installed')
    def test_hybrid_search_uses_the_saved_key(self):
        self.build()
        connected = self.client.post('/api/ui/retrieval-connection', json={'key': 'g' * 20}, headers=self.headers)
        self.assertEqual(connected.json()['semantic'], True)
        with patch('paramyth.rag.db.encode_query', return_value=vector(1)) as encode:
            result = self.search(mode='hybrid').json()
        encode.assert_called_once()
        self.assertEqual({s['id'] for s in result['sources']}, {'a', 'b'})
        self.assertEqual(self.client.post('/api/ui/retrieval-connection', json={'key': 'short'}, headers=self.headers).status_code, 422)


if __name__ == '__main__':
    unittest.main()
