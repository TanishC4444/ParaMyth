"""Story atlas: every enabled top-level corpus work is mapped once, and the API serves the database's records."""
import json
import unittest
from pathlib import Path

try:
    from fastapi.testclient import TestClient
except ImportError:  # the API is an optional extra: pip install -e '.[api,test]'
    TestClient = None

ROOT = Path(__file__).resolve().parents[1]
P = '/api/v1/atlas'


class PlacesTest(unittest.TestCase):
    def test_places_cover_enabled_top_level_works(self):
        records = json.loads((ROOT / 'data/literary-corpus.json').read_text(encoding='utf-8'))['records']
        expected = {r['id'] for r in records if not r['parent_id'] and r['retrieval']['enabled']}
        places = json.loads((ROOT / 'data/atlas-places.json').read_text(encoding='utf-8'))['places']
        self.assertEqual(expected, set(places))
        for rid, p in places.items():
            self.assertTrue(-90 <= p['lat'] <= 90 and -180 <= p['lng'] <= 180, rid)
            self.assertIn(p['basis'], {'origin', 'setting'}, rid)
            self.assertTrue(p['place'].strip() and p['region'].strip(), rid)


@unittest.skipIf(TestClient is None, 'API extra not installed')
class AtlasApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from paramyth.pipeline.api.app import app
        cls.client = TestClient(app)

    def test_index_lists_mapped_stories_without_a_token(self):
        body = self.client.get(f'{P}/stories').json()
        self.assertEqual(len(body['stories']), 385)
        self.assertIn('South Asia', body['regions'])
        first = body['stories'][0]
        self.assertEqual(first['id'], 'work_001')
        self.assertNotIn('children', first)

    def test_detail_reads_record_and_episodes_from_database(self):
        enriched = self.client.get(f'{P}/stories/work_001').json()
        self.assertTrue(enriched['detailed'])
        self.assertIn('gingerbread', enriched['summary'])
        self.assertEqual(enriched['tradition'], 'Brothers Grimm Collection (Kinder- und Hausmärchen)')
        epic = self.client.get(f'{P}/stories/work_274').json()
        self.assertEqual(epic['episodes'], len(epic['children']))
        self.assertTrue(epic['children'] and epic['children'][0]['id'].startswith('work_274_ep'))

    def test_unmapped_and_disabled_records_are_not_found(self):
        self.assertEqual(self.client.get(f'{P}/stories/work_267').status_code, 404)
        self.assertEqual(self.client.get(f'{P}/stories/work_274_ep001').status_code, 404)

    def test_frontend_snapshot_is_current(self):
        from scripts.export_atlas import OUT, INDEX, snapshot, index_snapshot
        self.assertTrue(OUT.is_file(), 'Run python -m scripts.export_atlas')
        self.assertEqual(json.loads(OUT.read_text(encoding='utf-8')), snapshot(), 'Run python -m scripts.export_atlas')
        self.assertEqual(json.loads(INDEX.read_text(encoding='utf-8')),index_snapshot(snapshot()))


if __name__ == '__main__':
    unittest.main()
