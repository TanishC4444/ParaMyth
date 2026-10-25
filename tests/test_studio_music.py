"""Soundtrack routes: local ambience, Vultr jobs, playback, saving and cancelling."""
import io
import json
import os
import unittest
from unittest.mock import patch

from test_studio_projects import StudioTestCase, wait

KEY = {'VULTR_INFERENCE_API_KEY': 'test-key'}
SPEC = {'id': 'minimax-music3', 'lyrics': 'optional', 'duration': {'min': 5, 'max': 360}}
JOB = 'music_' + 'c' * 24


class Audio(io.BytesIO):
    headers = {'Content-Type': 'audio/mpeg'}

    def __enter__(self):
        return self


class MusicTests(StudioTestCase):
    def setUp(self):
        super().setUp()
        self.ident = self.project(text='Wind and rain crossed the harbor at night.')
        self.query = {'project_id': self.ident}
        self.headers = {'X-ParaMyth-Token': self.token}

    def create(self, body):
        return self.client.post('/api/studio/music', params=self.query, json=body, headers=self.headers)

    def test_local_ambience_renders_without_a_provider(self):
        with patch.dict(os.environ, {'VULTR_INFERENCE_API_KEY': ''}), patch('paramyth.soundtracks.request_json') as provider:
            started = self.create({'mode': 'ambience', 'seconds': 5})
            self.assertEqual(started.status_code, 202, started.text)
            job = wait(self.runtime, started.json()['job_id'])
        provider.assert_not_called()
        track = job['result']['job']['id']
        self.assertTrue(track.startswith('local_'))
        audio = self.client.get(f'/media/music/{track}/content', params=self.query)
        self.assertEqual((audio.status_code, audio.headers['content-type'], audio.content[:4]), (200, 'audio/wav', b'RIFF'))
        self.assertEqual(self.client.get('/api/studio/music', params=self.query).json()['tracks'][0]['job']['id'], track)
        saved = self.client.post(f'/api/studio/music/{track}/save', params=self.query, headers=self.headers).json()
        self.assertEqual(saved['file'], f'soundtracks/{track}.wav')

    def test_score_job_polls_saves_and_streams_from_vultr(self):
        with patch.dict(os.environ, KEY), patch('paramyth.soundtracks.request_json', side_effect=[{'data': [SPEC]}, {'id': JOB, 'status': 'queued'}]):
            job = wait(self.runtime, self.create({'mode': 'score', 'seconds': 30}).json()['job_id'])
        self.assertEqual(job['status'], 'complete', job)
        self.assertEqual(job['result']['provider'], 'Vultr Serverless Inference')
        with patch.dict(os.environ, KEY), patch('paramyth.soundtracks.request_json', return_value={'id': JOB, 'status': 'completed'}) as poll:
            self.assertEqual(self.client.get(f'/api/studio/music/{JOB}', params=self.query).json()['job']['status'], 'completed')
            self.client.get(f'/api/studio/music/{JOB}', params=self.query)
        self.assertEqual(poll.call_count, 1)
        with patch.dict(os.environ, KEY), patch('paramyth.soundtracks.audio', return_value=Audio(b'ID3track')) as audio:
            self.assertEqual(self.client.post(f'/api/studio/music/{JOB}/save', params=self.query, headers=self.headers).json()['file'], f'soundtracks/{JOB}.mp3')
            self.assertEqual(self.client.get(f'/media/music/{JOB}/content', params=self.query).content, b'ID3track')
        self.assertEqual(audio.call_count, 1)

    def test_cancel_marks_the_job_and_local_tracks_cannot_be_cancelled(self):
        folder = self.runtime.folder(self.ident) / 'soundtracks'
        folder.mkdir()
        (folder / (JOB + '.json')).write_text(json.dumps({'id': JOB, 'cue': {}, 'job': {'id': JOB, 'status': 'running'}, 'last_check': 9e12}))
        with patch.dict(os.environ, KEY), patch('paramyth.soundtracks.cancel') as cancel:
            self.assertEqual(self.client.post(f'/api/studio/music/{JOB}/cancel', params=self.query, headers=self.headers).json(), {'cancelled': True})
        cancel.assert_called_once_with(JOB)
        self.assertEqual(json.loads((folder / (JOB + '.json')).read_text())['job']['status'], 'cancelled')
        local = 'local_' + 'd' * 24
        (folder / (local + '.json')).write_text(json.dumps({'job': {'id': local, 'status': 'completed'}, 'file': local + '.wav'}))
        self.assertEqual(self.client.post(f'/api/studio/music/{local}/cancel', params=self.query, headers=self.headers).status_code, 422)

    def test_invalid_requests_and_foreign_tracks_are_refused(self):
        self.assertEqual(self.create({'mode': 'ambience', 'seconds': 4}).status_code, 422)
        self.assertEqual(self.create({'mode': 'opera'}).status_code, 422)
        with patch.dict(os.environ, {'VULTR_INFERENCE_API_KEY': ''}):
            self.assertEqual(self.create({'mode': 'song', 'seconds': 30}).status_code, 422)
        self.assertEqual(self.runtime.jobs, {})
        self.assertEqual(self.client.get('/api/studio/music/../../etc', params=self.query).status_code, 404)
        self.assertEqual(self.client.get(f'/api/studio/music/{JOB}', params=self.query).status_code, 422)
        self.assertEqual(self.client.get(f'/media/music/{JOB}/delete', params=self.query).status_code, 422)


if __name__ == '__main__':
    unittest.main()
