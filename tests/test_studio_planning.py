"""Production planning routes: plan jobs, recalculation, exports and calendar OAuth."""
import json
import os
import time
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from test_studio_projects import StudioTestCase, wait

KEY = {'VULTR_INFERENCE_API_KEY': 'test-key', 'SERPAPI_API_KEY': ''}
SCENE = {'id': 's1', 'title': 'Shore', 'location': 'shore', 'description': 'Waiting', 'cast': ['Mara'], 'minutes': 60, 'light': 'day'}
BREAKDOWN = {'title': 'Harbor', 'scenes': [SCENE], 'search_queries': [],
             'budget_items': [{'category': 'crew', 'description': 'Crew', 'quantity': 1, 'unit': 'day', 'low_rate': 100, 'high_rate': 200, 'basis': 'estimate'}]}
ADVICE = {'summary': 'Scout', 'locations': [], 'legal_logistics': []}


def reply(value):
    return {'choices': [{'message': {'content': json.dumps(value)}, 'finish_reason': 'stop'}], 'usage': {}}


class PlanningTests(StudioTestCase):
    def setUp(self):
        super().setUp()
        self.ident = self.project(text='Mara waits on the shore.')
        self.query = {'project_id': self.ident}
        self.headers = {'X-ParaMyth-Token': self.token}

    def make_plan(self):
        with patch.dict(os.environ, KEY), patch('paramyth.production.request_json', side_effect=[reply(BREAKDOWN), reply(ADVICE)]):
            started = self.client.post('/api/generate', params=self.query, json={'config': {'start_date': '2026-11-02'}, 'images': []}, headers=self.headers)
            self.assertEqual(started.status_code, 202, started.text)
            job = wait(self.runtime, started.json()['job_id'])
        self.assertEqual(job['status'], 'complete', job)
        return self.client.get('/api/job/' + job['id']).json()['plan_id']

    def test_plan_job_lists_reads_recalculates_and_exports(self):
        ident = self.make_plan()
        config = self.client.get('/api/config', params=self.query).json()
        self.assertEqual(config['plans'], [ident])
        self.assertEqual(config['redirect_uri'], 'http://testserver/google/callback')
        plan = self.client.get('/api/plan/' + ident, params=self.query).json()
        self.assertEqual(plan['budget']['total_low'], 115.0)
        items = [{**BREAKDOWN['budget_items'][0], 'low_rate': 300, 'high_rate': 400}]
        updated = self.client.post('/api/recalculate', params=self.query, json={'id': ident, 'budget_items': items}, headers=self.headers).json()
        self.assertEqual(updated['budget']['total_low'], 345.0)
        self.assertNotEqual(updated['id'], ident)
        self.assertIn('edited locally', updated['warnings'][-1])
        ics = self.client.get(f'/export/{ident}/calendar.ics', params=self.query)
        self.assertIn(b'BEGIN:VEVENT', ics.content)
        self.assertEqual(ics.headers['content-disposition'], 'attachment; filename="paramyth-calendar.ics"')
        self.assertEqual(self.client.get(f'/export/{ident}/secrets.txt', params=self.query).status_code, 422)

    def test_invalid_requests_start_no_plan_job(self):
        for body in ({'config': {'currency': 'dollars'}}, {'config': {}, 'images': [{}] * 4}):
            self.assertEqual(self.client.post('/api/generate', params=self.query, json=body, headers=self.headers).status_code, 422)
        self.assertEqual(self.runtime.jobs, {})
        self.assertEqual(self.client.get('/api/plan/../../secret', params=self.query).status_code, 404)
        self.assertEqual(self.client.get('/api/plan/nothex', params=self.query).status_code, 422)

    def test_calendar_sync_uses_the_saved_plan(self):
        ident = self.make_plan()
        with patch.object(self.runtime.google, 'sync', return_value={'created': [], 'existing': [], 'conflicts': []}) as sync:
            self.client.post('/api/calendar-sync', params=self.query, json={'id': ident}, headers=self.headers)
        self.assertEqual(sync.call_args.args[0]['id'], ident)
        self.assertEqual(sync.call_args.args[1], 'primary')

    def test_google_oauth_uses_pkce_and_single_use_state(self):
        with patch.dict(os.environ, {'GOOGLE_CLIENT_ID': '', 'GOOGLE_CLIENT_SECRET': ''}):
            self.assertEqual(self.client.get('/google/connect', follow_redirects=False).status_code, 422)
        with patch.dict(os.environ, {'GOOGLE_CLIENT_ID': 'client', 'GOOGLE_CLIENT_SECRET': 'secret'}):
            redirect = self.client.get('/google/connect', follow_redirects=False)
        query = parse_qs(urlsplit(redirect.headers['location']).query)
        self.assertEqual(query['code_challenge_method'], ['S256'])
        state = query['state'][0]
        token = {'access_token': 'a', 'refresh_token': 'r', 'expires_in': 3600}
        with patch.object(self.runtime.google, 'form_token', return_value=token) as exchange:
            done = self.client.get('/google/callback', params={'state': state, 'code': 'c'}, follow_redirects=False)
            replay = self.client.get('/google/callback', params={'state': state, 'code': 'c'}, follow_redirects=False)
        self.assertEqual((done.status_code, done.headers['location']), (307, '/#/production'))
        self.assertEqual(replay.status_code, 422)
        self.assertEqual(exchange.call_count, 1)
        self.assertGreaterEqual(len(exchange.call_args.args[0]['code_verifier']), 43)
        self.assertTrue(self.client.get('/api/config', params=self.query).json()['google'])
        self.runtime.oauth['old'] = (time.time() - 601, 'v')
        self.assertEqual(self.client.get('/google/callback', params={'state': 'old', 'code': 'c'}).status_code, 422)


if __name__ == '__main__':
    unittest.main()
