import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from paramyth.production import create_plan
from paramyth.production_research import Search, safe_url
from paramyth.providers import ProviderError


def hit(title='Film office', link='https://example.gov/film'):
    return {'organic_results': [{'title': title, 'link': link, 'snippet': 'Check permits'}]}


class ResearchTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)

    def test_cache_and_failover_conserve_calls_and_never_store_keys(self):
        client = Search(self.root, keys=['primary', 'backup'], daily_limit=5, plan_limit=1)
        with patch('paramyth.production_research.request_json', side_effect=[ProviderError('Provider HTTP 429'), hit()]) as call:
            first = client('film office', 'legal')
            self.assertFalse(first['cached'])
            self.assertEqual(call.call_count, 2)
            self.assertTrue(client('film   office', 'legal')['cached'])
            self.assertEqual(call.call_count, 2)
            with self.assertRaisesRegex(ProviderError, 'Per-plan'):
                client('other')
        stored = client.db.read_bytes()
        self.assertNotIn(b'primary', stored)
        self.assertNotIn(b'backup', stored)
        fresh = Search(self.root, keys=['primary', 'backup'], plan_limit=1)
        with patch('paramyth.production_research.request_json', return_value={'organic_results': []}) as call:
            fresh('another query')
        self.assertEqual(call.call_count, 1)
        self.assertIn('backup', call.call_args.args[0])

    def test_daily_allowance_and_no_blind_retry_on_server_errors(self):
        client = Search(self.root, keys=['a', 'b', 'c'], daily_limit=1, plan_limit=3)
        with patch('paramyth.production_research.request_json', return_value={'organic_results': []}) as call:
            client('one')
            with self.assertRaisesRegex(ProviderError, 'Daily'):
                client('two')
        self.assertEqual(call.call_count, 1)
        other = Search(self.root / 'other', keys=['a', 'b'], daily_limit=5, plan_limit=3)
        with patch('paramyth.production_research.request_json', side_effect=ProviderError('Provider HTTP 500')) as call:
            with self.assertRaises(ProviderError):
                other('failed')
        self.assertEqual(call.call_count, 1)

    def test_unsafe_links_are_dropped(self):
        self.assertEqual(safe_url('javascript:alert(1)'), '')
        self.assertEqual(safe_url('https://user:pw@example.com/'), '')
        client = Search(self.root, keys=['k'], plan_limit=1)
        with patch('paramyth.production_research.request_json', return_value=hit(link='javascript:alert(1)')):
            self.assertEqual(client('query')['results'], [])

    def test_missing_keys_report_instead_of_searching(self):
        with patch('paramyth.production_research.request_json') as call, self.assertRaisesRegex(ProviderError, 'not configured'):
            Search(self.root, keys=[])('query')
        call.assert_not_called()

    def test_cache_keeps_purpose_and_legal_freshness_separate(self):
        client = Search(self.root, keys=['key'], plan_limit=3)
        with patch('paramyth.production_research.time.time', return_value=1000), \
                patch('paramyth.production_research.request_json', return_value=hit()) as call:
            self.assertEqual(client('film permits', 'location')['purpose'], 'location')
            self.assertEqual(client('film permits', 'legal')['purpose'], 'legal')
            self.assertEqual(call.call_count, 2)
        fresh = Search(self.root, keys=['key'], plan_limit=3)
        with patch('paramyth.production_research.time.time', return_value=22601), \
                patch('paramyth.production_research.request_json', return_value=hit()) as call:
            self.assertTrue(fresh('film permits', 'location')['cached'])
            self.assertFalse(fresh('film permits', 'legal')['cached'])
            self.assertEqual(call.call_count, 1)

    def test_keys_are_trimmed_before_deduplication(self):
        client = Search(self.root, keys=[' key ', 'key', '', 'backup'], plan_limit=1)
        with patch('paramyth.production_research.request_json', side_effect=[ProviderError('Provider HTTP 429'), hit()]) as call:
            client('query')
        self.assertEqual(call.call_count, 2)
        self.assertIn('api_key=backup', call.call_args.args[0])

    def test_invalid_inputs_do_not_spend_allowance(self):
        client = Search(self.root, keys=['key'], plan_limit=1)
        for query, purpose in [('', 'location'), (None, 'location'), ('query', []), ('query', '')]:
            with self.subTest(query=query, purpose=purpose), self.assertRaises(ValueError):
                client(query, purpose)
        self.assertEqual(client.used, 0)

    def test_negative_results_are_cached_without_key_failover(self):
        client = Search(self.root, keys=['key', 'backup'], plan_limit=1)
        with patch('paramyth.production_research.request_json', return_value={
                'search_metadata': {'status': 'Success'}, 'error': "Google hasn't returned any results for this query."}) as call:
            self.assertEqual(client('obscure query')['results'], [])
            self.assertTrue(client('obscure query')['cached'])
            self.assertEqual(call.call_count, 1)

    def test_malformed_results_are_not_cached(self):
        for i, value in enumerate([[], {'organic_results': None}, {'organic_results': [None]}]):
            client = Search(self.root / str(i), keys=['key'], plan_limit=2)
            with patch('paramyth.production_research.request_json', return_value=value), self.assertRaises(ProviderError):
                client('query')
            with patch('paramyth.production_research.request_json', return_value=hit()) as call:
                self.assertFalse(client('query')['cached'])
                self.assertEqual(call.call_count, 1)

    @patch.dict(os.environ, {'VULTR_INFERENCE_API_KEY': 'test-key', 'SERPAPI_API_KEY': 'serp-key'})
    def test_plan_uses_serpapi_by_default_when_configured(self):
        (self.root / 'story.txt').write_text('A Troy story')
        scene = {'id': 's1', 'title': 'Shore', 'location': 'shore', 'description': 'Waiting', 'cast': [], 'minutes': 60, 'light': 'day'}
        breakdown = {'title': 'Troy', 'scenes': [scene], 'budget_items': [], 'search_queries': [{'purpose': 'location', 'query': 'beach'}]}
        advice = {'locations': [{'name': 'Film office', 'match': 'coast', 'source_ids': ['R1']}], 'legal_logistics': []}
        reply = lambda v: {'choices': [{'message': {'content': json.dumps(v)}, 'finish_reason': 'stop'}]}
        with patch('paramyth.production.request_json', side_effect=[reply(breakdown), reply(advice)]), \
                patch('paramyth.production_research.request_json', return_value=hit()) as search:
            plan = create_plan(self.root, {'region': 'Galveston'})
        self.assertEqual(search.call_count, 1)
        self.assertIn('serp-key', search.call_args.args[0])
        self.assertEqual(plan['evidence'][0]['url'], 'https://example.gov/film')
        self.assertNotIn('serp-key', json.dumps(plan))


if __name__ == '__main__':
    unittest.main()
