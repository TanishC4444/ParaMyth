"""Creative writing routes: streamed jobs, live events and adopting results."""
import json
import os
import unittest
from unittest.mock import patch

from test_studio_projects import StudioTestCase, wait

KEY = {'VULTR_INFERENCE_API_KEY': 'test-key'}


def streamed(messages, on_chunk, **options):
    on_chunk('{"title":"Bell","text":"First words')
    content = json.dumps({'title': 'Bell', 'text': 'First words, finished.', 'assumptions': [],
                          'completed_brief': {'medium': 'Short story', 'genre': 'Drama', 'characters': ['Mara', {'name': 'Oren', 'arc': {'starting_belief': 'Alone'}}]}})
    return {'choices': [{'message': {'content': content}, 'finish_reason': 'stop'}], 'usage': {'total_tokens': 9}}


class WritingTests(StudioTestCase):
    def setUp(self):
        super().setUp()
        self.ident = self.project()
        self.query = {'project_id': self.ident}

    def start(self, body=None):
        return self.client.post('/api/ui/creative', params=self.query, json=body or {'operation': 'draft', 'use_story': False},
                                headers={'X-ParaMyth-Token': self.token})

    def test_missing_key_or_bad_request_starts_no_job(self):
        with patch.dict(os.environ, {'VULTR_INFERENCE_API_KEY': ''}):
            self.assertEqual(self.start().status_code, 422)
        with patch.dict(os.environ, KEY):
            self.assertEqual(self.start({'operation': 'publish'}).status_code, 422)
        self.assertEqual(self.runtime.jobs, {})

    def test_streamed_draft_is_recorded_and_replayed_as_events(self):
        with patch.dict(os.environ, KEY), patch('paramyth.vultr.stream_chat', side_effect=streamed):
            started = self.start()
            self.assertEqual(started.status_code, 202, started.text)
            job = wait(self.runtime, started.json()['job_id'])
        self.assertEqual(job['status'], 'complete', job)
        self.assertEqual(job['preview']['text'], 'First words, finished.')
        listed = self.client.get('/api/ui/creative/jobs', params=self.query).json()['jobs']
        self.assertEqual([j['id'] for j in listed], [job['id']])
        with self.client.stream('GET', f"/api/ui/creative/jobs/{job['id']}/events", params=self.query) as response:
            self.assertEqual(response.headers['content-type'].split(';')[0], 'text/event-stream')
            body = ''.join(response.iter_text())
        self.assertEqual(body.count('event: progress'), 1)
        self.assertIn('First words, finished.', body)
        records = self.client.get('/api/ui/creative', params=self.query).json()['results']
        self.assertEqual(records[0]['status'], 'complete')

    def test_jobs_are_scoped_to_their_project(self):
        other = self.project('Forge', 'Sparks')
        self.runtime.jobs['a' * 24] = {'id': 'a' * 24, 'project_id': self.ident, 'streaming': True, 'status': 'running', 'created_at': 'now'}
        self.assertEqual(self.client.get('/api/ui/creative/jobs/' + 'a' * 24, params={'project_id': other}).status_code, 404)
        self.assertEqual(self.client.get('/api/ui/creative/jobs/' + 'a' * 24, params=self.query).status_code, 200)

    def test_completed_result_becomes_a_project_with_its_brief(self):
        with patch.dict(os.environ, KEY), patch('paramyth.vultr.stream_chat', side_effect=streamed):
            job = wait(self.runtime, self.start().json()['job_id'])
        record = job['preview']['record_id']
        adopted = self.client.post(f'/api/ui/creative/{record}/use-as-project', params=self.query, headers={'X-ParaMyth-Token': self.token})
        self.assertEqual(adopted.status_code, 200, adopted.text)
        p = adopted.json()['project']
        self.assertEqual((p['title'], p['brief']['medium'], p['scenes'][0]['content']), ('Bell', 'Short story', 'First words, finished.'))
        self.assertEqual([c['name'] for c in p['brief']['characters']], ['Mara', 'Oren'])
        self.assertEqual(p['brief']['characters'][1]['arc']['belief'], 'Alone')
        root = self.runtime.folder(adopted.json()['id'])
        self.assertEqual(json.loads((root / 'request.json').read_text())['creative_source']['creative_result_id'], record)
        self.assertTrue((root / 'creative-source.json').is_file())

    def test_unfinished_or_invalid_results_are_not_adopted(self):
        folder = self.runtime.folder(self.ident) / 'creative'
        folder.mkdir()
        (folder / ('b' * 24 + '.json')).write_text(json.dumps({'status': 'failed', 'request': {}}))
        post = lambda ident: self.client.post(f'/api/ui/creative/{ident}/use-as-project', params=self.query, headers={'X-ParaMyth-Token': self.token})
        self.assertEqual(post('b' * 24).status_code, 422)
        self.assertEqual(post('..%2Fsecret').status_code, 404)
        self.assertEqual(post('ZZ').status_code, 422)


if __name__ == '__main__':
    unittest.main()
