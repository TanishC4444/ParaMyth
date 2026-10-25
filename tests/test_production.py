import base64
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from paramyth.production import Muse, budget, create_plan, normalize_config, schedule, validate_breakdown, validate_recommendations
from paramyth.providers import ProviderError

KEY = {'VULTR_INFERENCE_API_KEY': 'test-key', 'SERPAPI_API_KEY': ''}


def scene(ident='s1', **overrides):
    return {'id': ident, 'title': 'Scene ' + ident, 'location': 'shore', 'description': 'Film action', 'cast': ['Meles'],
            'minutes': 60, 'light': 'day', 'dependencies': [], 'props': [], 'risks': [], **overrides}


def breakdown():
    return {'title': 'Troy', 'scenes': [scene()], 'search_queries': [], 'assumptions': [], 'missing_info': [], 'visual_criteria': [],
            'budget_items': [{'category': 'crew', 'description': 'Crew', 'quantity': 3, 'unit': 'day', 'low_rate': 100.1, 'high_rate': 150, 'basis': 'estimate'}]}


def reply(value):
    return {'model': 'muse-glimmer-30b', 'choices': [{'message': {'content': json.dumps(value)}, 'finish_reason': 'stop'}], 'usage': {'total_tokens': 7}}


class ProductionTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.cfg = normalize_config({'start_date': '2026-11-02', 'timezone': 'America/Chicago'})

    def test_validation_rejects_cycles_bad_rates_and_unknown_sources(self):
        value = breakdown()
        validate_breakdown(value)
        value['scenes'] = [scene('a', dependencies=['b']), scene('b', dependencies=['a'])]
        with self.assertRaisesRegex(ValueError, 'cycle'):
            validate_breakdown(value)
        with self.assertRaises(ValueError):
            normalize_config({'contingency': float('nan')})
        with self.assertRaises(ValueError):
            normalize_config({'currency': 'dollars'})
        value = breakdown()
        value['budget_items'][0]['low_rate'] = -1
        with self.assertRaises(ValueError):
            validate_breakdown(value)
        with self.assertRaises(ValueError):
            validate_recommendations({'locations': [{'source_ids': ['invented']}]}, [])

    def test_schedule_respects_availability_dependencies_meals_and_turnaround(self):
        cfg = {**self.cfg, 'cast_unavailable': {'Meles': ['2026-11-02']}, 'blackout_dates': ['2026-11-04']}
        scenes = [scene('a', minutes=210), scene('b', minutes=210, location='forge', dependencies=['a']),
                  scene('c', minutes=60, light='night', dependencies=['b'])]
        result = schedule(scenes, cfg)
        self.assertFalse(result['unscheduled'])
        events = result['events']
        self.assertEqual([e['scene_id'] for e in events], ['a', 'b', 'c'])
        for e in events:
            self.assertNotIn(e['start'][:10], ['2026-11-02', '2026-11-04'])
            self.assertLess(datetime.fromisoformat(e['start']), datetime.fromisoformat(e['end']))
        self.assertTrue(events[1]['meal_before'])
        self.assertEqual(events[1]['setup_move_minutes'], 75)
        self.assertGreaterEqual(datetime.fromisoformat(events[2]['start']) - datetime.fromisoformat(events[1]['end']), timedelta(hours=12))

    def test_impossible_scene_is_reported_and_turnaround_holds_across_dst(self):
        cfg = {**self.cfg, 'day_hours': 4, 'skip_weekends': False, 'start_date': '2026-10-31'}
        self.assertEqual(schedule([scene('long', minutes=600)], cfg)['unscheduled'], ['long'])
        events = schedule([scene('n', light='night', minutes=60), scene('d', dependencies=['n'])], cfg)['events']
        self.assertEqual(len(events), 2)
        gap = datetime.fromisoformat(events[1]['start']).astimezone(timezone.utc) - datetime.fromisoformat(events[0]['end']).astimezone(timezone.utc)
        self.assertGreaterEqual(gap, timedelta(hours=12))

    def test_budget_uses_exact_arithmetic_and_excludes_unknowns(self):
        rows = breakdown()['budget_items'] + [{'category': 'permits', 'description': 'Permit', 'quantity': 1, 'unit': 'item', 'low_rate': 0, 'high_rate': 0, 'basis': 'unknown'}]
        result = budget(rows, {**self.cfg, 'budget_cap': 500})
        self.assertEqual((result['subtotal_low'], result['total_low'], result['total_high']), (300.3, 345.35, 517.5))
        self.assertTrue(result['over_cap'])
        self.assertEqual(result['unknown_costs'], ['Permit'])

    @patch.dict(os.environ, KEY)
    def test_vision_payload_and_bad_images(self):
        muse = Muse()
        image = {'mime': 'image/png', 'data': base64.b64encode(b'\x89PNG\r\n\x1a\nTEST').decode()}
        with patch('paramyth.production.request_json', return_value=reply({'ok': True})) as call:
            self.assertTrue(muse.ask('test', {'story': 'text'}, [image])['ok'])
        url, payload = call.call_args.args[:2]
        self.assertEqual((url, payload['model']), ('https://api.vultrinference.com/v1/chat/completions', 'muse-glimmer-30b'))
        self.assertEqual(payload['messages'][1]['content'][1]['type'], 'image_url')
        for bad in ({'mime': 'image/png', 'data': 'not-base64'}, {'mime': 'image/gif', 'data': image['data']},
                    {'mime': 'image/jpeg', 'data': image['data']}):
            with self.subTest(mime=bad['mime']), self.assertRaises(ValueError):
                muse.ask('test', {}, [bad])
        with self.assertRaises(ValueError):
            muse.ask('test', {}, [image] * 4)

    def test_missing_key_fails_before_any_request(self):
        with patch.dict(os.environ, {'VULTR_INFERENCE_API_KEY': ''}), self.assertRaisesRegex(ProviderError, 'VULTR_INFERENCE_API_KEY'):
            Muse()

    @patch.dict(os.environ, KEY)
    def test_plan_without_research_is_saved_with_warnings_and_scaled_day_rates(self):
        (self.root / 'story.txt').write_text('Meles waits on the shore of Troy.')
        value = breakdown()
        value['scenes'] = [scene('a', minutes=480), scene('b', minutes=480, dependencies=['a'])]
        value['budget_items'][0]['quantity'] = 1
        advice = {'summary': 'Scout the coast', 'locations': [], 'legal_logistics': [{'task': 'Check permits', 'owner': 'producer', 'source_ids': []}],
                  'crew_equipment': [], 'risks': [], 'next_steps': []}
        with patch('paramyth.production.request_json', side_effect=[reply(value), reply(advice)]) as call:
            plan = create_plan(self.root, {'start_date': '2026-11-02', 'region': 'Aegean coast'})
        self.assertEqual(call.call_count, 2)
        self.assertEqual(plan['schedule']['shoot_days'], 2)
        self.assertEqual(plan['budget']['items'][0]['quantity'], 2)
        self.assertIn('Web research is not configured', plan['warnings'][0])
        self.assertEqual(plan['recommendations']['legal_logistics'][0]['verification'], 'unverified planning suggestion')
        self.assertEqual(json.loads((self.root / 'production' / 'plans' / (plan['id'] + '.json')).read_text())['title'], 'Troy')

    @patch.dict(os.environ, KEY)
    def test_research_results_become_cited_evidence(self):
        (self.root / 'story.txt').write_text('A Troy story')
        value = breakdown()
        value['search_queries'] = [{'purpose': 'legal', 'query': 'film permit'}]
        advice = {'locations': [{'name': 'Film office', 'match': 'permits', 'source_ids': ['R1']}], 'legal_logistics': []}
        found = {'query': 'q', 'purpose': 'legal', 'retrieved_at': 1.0, 'evidence_level': 'search_snippet_only',
                 'results': [{'title': 'Film office', 'url': 'https://example.gov/film', 'snippet': 'Permits'}]}
        searches = []
        search = lambda query, purpose: searches.append((query, purpose)) or found
        with patch('paramyth.production.request_json', side_effect=[reply(value), reply(advice)]):
            plan = create_plan(self.root, {'region': 'Aegean coast'}, search=search)
        self.assertEqual(searches, [('film permit Aegean coast', 'legal')])
        self.assertEqual(plan['evidence'][0]['id'], 'R1')
        self.assertEqual(plan['recommendations']['locations'][0]['verification'], 'search lead; verify with authority/owner')


if __name__ == '__main__':
    unittest.main()
