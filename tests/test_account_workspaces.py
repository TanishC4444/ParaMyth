"""Hosted account isolation and durable restore against a disposable PostgreSQL database."""
import os
from pathlib import Path
import secrets
import shutil
import tempfile
import unittest
from unittest.mock import patch

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from paramyth.studio.app import create_app
from paramyth.studio.studio_db import connection
from paramyth.storage import save, load
from test_studio_workspace import author_project

ORIGIN = 'https://stories.example.tech'


@unittest.skipUnless(os.environ.get('PARAMYTH_TEST_DATABASE_URL'), 'Set a disposable PostgreSQL test URL')
class AccountWorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'volume'
        self.prefix = secrets.token_hex(8)
        self.users = []
        self.apps = []
        self.env = patch.dict(os.environ, {
            'PARAMYTH_DATABASE_URL': os.environ['PARAMYTH_TEST_DATABASE_URL'],
            'PARAMYTH_ENCRYPTION_KEY': Fernet.generate_key().decode(),
            'GOOGLE_CALENDAR_ACCESS_TOKEN': 'never-share-the-owner-calendar',
            'GOOGLE_CALENDAR_REFRESH_TOKEN': 'never-share-owner-refresh',
        })
        self.env.start()
        self.app = self.make_app(self.root)
        self.a, self.au = self.signup('alice')
        self.b, self.bu = self.signup('bob')

    def make_app(self, root):
        app = create_app(root, frontend=None, public_origin=ORIGIN)
        self.apps.append(app)
        return app

    def client(self, app=None):
        return TestClient(app or self.app, base_url=ORIGIN, client=('hosted-' + self.prefix, 12345))

    def signup(self, name):
        client = self.client()
        result = client.post('/api/v1/accounts/signup', json={
            'email': f'{self.prefix}-{name}@example.invalid', 'password': 'x', 'display_name': name})
        self.assertEqual(result.status_code, 201, result.text)
        self.assertIn('HttpOnly', result.headers['set-cookie'])
        self.assertIn('Secure', result.headers['set-cookie'])
        user = result.json()['user']
        self.users.append(user)
        return client, user

    def headers(self, client):
        result = client.get('/api/ui/session')
        self.assertEqual(result.status_code, 200, result.text)
        return {'X-ParaMyth-Token': result.json()['csrf'], 'Origin': ORIGIN}

    def project(self, client, title='Harbor Bell'):
        result = client.post('/api/ui/projects', json={'project': author_project(title)}, headers=self.headers(client))
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def login(self, client, user):
        result = client.post('/api/v1/accounts/login', json={'email': user['email'], 'password': 'x'})
        self.assertEqual(result.status_code, 200, result.text)

    def tearDown(self):
        for app in self.apps:
            app.state.workspaces.close()
        with connection() as conn:
            conn.execute('DELETE FROM paramyth.users WHERE id = ANY(%s::uuid[])', ([u['id'] for u in self.users],))
            # Only this test's randomly named account/IP buckets.
            from paramyth.studio.studio_security import digest
            keys = [digest('auth-email:' + u['email']) for u in self.users]
            keys.append(digest('auth-ip:hosted-' + self.prefix))
            conn.execute('DELETE FROM paramyth.auth_limits WHERE bucket = ANY(%s)', (keys,))
        self.env.stop()
        self.temp.cleanup()

    def test_logout_login_restart_and_volume_restore(self):
        p = self.project(self.a)
        pid = p['id']
        h = self.headers(self.a)
        self.assertEqual(self.a.put('/api/ui/notes', json={'ideas': []}, headers={**h, 'X-ParaMyth-Account': self.bu['id']}).status_code, 409)
        self.assertEqual(self.a.patch(f'/api/ui/projects/{pid}/workspace', json={'music.direction': 'Quiet rain'}, headers=h).status_code, 200)
        self.assertEqual(self.a.put('/api/ui/notes', json={'ideas': ['The lost bell'], 'pins': []}, headers=h).status_code, 200)
        self.assertEqual(self.a.post('/api/studio/project/select', json={'id': pid}, headers=h).status_code, 200)
        runtime = self.app.state.workspaces.get(self.au['id'])
        folder = runtime.folder(pid)
        (folder / 'images').mkdir()
        (folder / 'images' / 'kept.png').write_bytes(b'fixture-image')
        save(folder / 'production' / 'plans' / 'saved.json', {'title': 'Saved schedule'})
        job = {'id': 'kept-job', 'kind': 'image', 'project_id': pid, 'status': 'complete', 'created_at': '2026-01-01', 'result': {'id': 'kept'}}
        runtime.jobs[job['id']] = job
        runtime.persist(job['id'])
        runtime.google.accept({'access_token': 'personal-access', 'refresh_token': 'personal-refresh', 'expires_in': 3600})
        self.assertNotIn(b'personal-access', runtime.google.path.read_bytes())
        self.assertEqual(self.a.post('/api/v1/accounts/logout', json={}).status_code, 204)
        self.assertEqual(self.a.get('/api/ui/workspace').status_code, 401)
        self.login(self.a, self.au)
        self.assertEqual(self.a.get('/api/ui/workspace').json()['ideas'], ['The lost bell'])
        self.app.state.workspaces.close()
        restored = Path(self.temp.name) / 'restored-volume'
        shutil.copytree(self.root, restored)
        restarted = self.make_app(restored)
        client = self.client(restarted)
        self.login(client, self.au)
        state = client.get('/api/ui/workspace').json()
        self.assertEqual(state['current'], pid)
        self.assertEqual(state['projects'][0]['scenes'][0]['content'], 'The bell cracked.')
        self.assertEqual(state['drafts'][pid]['music.direction'], 'Quiet rain')
        self.assertEqual(state['ideas'], ['The lost bell'])
        self.assertEqual(client.get('/api/job/kept-job').json()['status'], 'complete')
        self.assertEqual(client.get('/api/studio/output', params={'project_id': pid, 'path': 'images/kept.png'}).content, b'fixture-image')
        self.assertEqual(restarted.state.workspaces.get(self.au['id']).google.refresh, 'personal-refresh')

    def test_other_account_cannot_access_projects_media_jobs_or_calendar(self):
        p = self.project(self.a)
        self.project(self.b, 'Bob story')
        ar = self.app.state.workspaces.get(self.au['id'])
        br = self.app.state.workspaces.get(self.bu['id'])
        self.assertEqual((ar.google.access, br.google.refresh), ('', ''))
        ar.jobs['private-job'] = {'id': 'private-job', 'kind': 'image', 'status': 'complete'}
        ar.google.accept({'access_token': 'alice-calendar'})
        save(ar.folder(p['id']) / 'secret.txt', 'Alice only')
        for path in [f'/api/ui/projects/{p["id"]}/request', '/api/job/private-job',
                     f'/api/studio/output?project_id={p["id"]}&path=secret.txt',
                     f'/media/music/local_private/content?project_id={p["id"]}']:
            self.assertEqual(self.b.get(path).status_code, 404, path)
        self.assertEqual(self.b.patch(f'/api/ui/projects/{p["id"]}/workspace', json={'music.direction': 'stolen'}, headers=self.headers(self.b)).status_code, 404)
        self.assertEqual(br.google.access, '')
        self.assertEqual(self.b.get('/api/ui/workspace').json()['projects'][0]['title'], 'Bob story')

    def test_host_origin_csrf_and_shared_secret_guards(self):
        guest = self.client()
        for path in ['/api/ui/workspace', '/api/ui/session', '/media/music/local_test/content', '/export/test/ics']:
            self.assertEqual(guest.get(path).status_code, 401, path)
        self.assertEqual(guest.get('/api/ui/public-config').json()['shared_keys'], True)
        self.assertEqual(self.a.get('/api/ui/workspace', headers={'Host': 'evil.tech', 'X-Forwarded-Host': 'stories.example.tech'}).status_code, 400)
        h = self.headers(self.a)
        self.assertEqual(self.a.put('/api/ui/notes', json={'ideas': []}, headers={**h, 'Origin': 'https://evil.tech'}).status_code, 403)
        self.assertEqual(self.a.put('/api/ui/notes', json={'ideas': []}).status_code, 403)
        self.assertEqual(self.a.post('/api/ui/retrieval-connection', json={'key': 'do-not-set-this-key'}, headers=h).status_code, 403)
        self.assertNotEqual(os.getenv('GEMINI_API_KEY'), 'do-not-set-this-key')
        self.assertEqual(self.a.get('/api/ui/workspace', headers={'Authorization': 'Bearer invalid'}).status_code, 401)
        self.a.post('/api/v1/accounts/logout', json={})
        self.login(self.a, self.au)
        self.assertEqual(self.a.put('/api/ui/notes', json={'ideas': []}, headers=h).status_code, 403)
        response = self.a.get('/api/ui/workspace')
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertIn('max-age=', response.headers['strict-transport-security'])

    def test_completed_music_is_archived_and_retried_without_regeneration(self):
        p = self.project(self.a)
        manager = self.app.state.workspaces
        path = manager.get(self.au['id']).folder(p['id']) / 'soundtracks' / ('music_' + 'a' * 24 + '.json')
        save(path, {'job': {'id': path.stem, 'status': 'queued'}})
        with patch('paramyth.soundtracks.status', return_value={'id': path.stem, 'status': 'completed'}), \
             patch('paramyth.soundtracks.download', side_effect=OSError('offline')):
            manager.archive_music_once()
        self.assertIn('archive_error', load(path))
        with patch('paramyth.soundtracks.status') as status, \
             patch('paramyth.soundtracks.download', side_effect=lambda ident, target: target.write_bytes(b'music')) as download:
            manager.archive_music_once()
            manager.archive_music_once()
        status.assert_not_called()
        download.assert_called_once()
        self.assertEqual(path.with_suffix('.mp3').read_bytes(), b'music')
        self.assertEqual(load(path)['file'], path.with_suffix('.mp3').name)

    def test_shared_provider_runs_on_https_domain_and_keeps_output_private(self):
        from test_images import response
        from test_studio_projects import wait
        from urllib.parse import parse_qs, urlsplit
        p = self.project(self.a)
        settings = {'model': 'muse-image-1.0', 'prompt': 'Harbor at dawn', 'kind': 'scene', 'title': 'Harbor'}
        with patch.dict(os.environ, {'MUSE_IMAGE_API_KEY': 'server-image-key', 'GOOGLE_CLIENT_ID': 'client-id', 'GOOGLE_CLIENT_SECRET': 'server-secret'}), \
             patch('paramyth.image_studio.request_json', return_value=response()) as provider:
            result = self.a.post('/api/images/generate', params={'project_id': p['id']}, json=settings, headers=self.headers(self.a))
            self.assertEqual(result.status_code, 202, result.text)
            job = wait(self.app.state.workspaces.get(self.au['id']), result.json()['job_id'])
            self.assertEqual(job['status'], 'complete', job)
            provider.assert_called_once()
            features = self.a.get('/api/studio/features')
            self.assertTrue(features.json()['configured']['muse_image'])
            self.assertNotIn('server-image-key', features.text)
            redirect = self.a.get('/google/connect', follow_redirects=False)
            query = parse_qs(urlsplit(redirect.headers['location']).query)
            self.assertEqual(query['redirect_uri'], [ORIGIN + '/google/callback'])
            self.assertNotIn('server-secret', redirect.headers['location'])
        ident = job['result']['id']
        url = f'/media/images/{ident}/0.png?project_id={p["id"]}'
        self.assertEqual(self.a.get(url).content[:4], b'\x89PNG')
        self.assertEqual(self.b.get(url).status_code, 404)


class HostedConfigurationTests(unittest.TestCase):
    def test_public_origin_and_key_fail_closed(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(ValueError):
                create_app(root, public_origin='http://example.tech')
            with patch.dict(os.environ, {'PARAMYTH_ENCRYPTION_KEY': ''}), self.assertRaises(ValueError):
                create_app(root, public_origin=ORIGIN)


if __name__ == '__main__':
    unittest.main()
