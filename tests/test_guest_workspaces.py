"""Public hosted workspaces work without accounts and stay separate by browser."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from paramyth.studio.app import create_app
from test_studio_workspace import author_project


ORIGIN = 'https://stories.example.tech'


class GuestWorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'volume'
        self.guest_a, self.guest_b = str(uuid4()), str(uuid4())
        self.env = patch.dict(os.environ, {
            'PARAMYTH_ENCRYPTION_KEY': Fernet.generate_key().decode(),
            'PARAMYTH_FRONTEND_ORIGIN': 'https://paramyth.tech',
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.app = create_app(self.root, frontend=None, public_origin=ORIGIN)
        self.addCleanup(self.app.state.workspaces.close)
        self.a = TestClient(self.app, base_url=ORIGIN)
        self.b = TestClient(self.app, base_url=ORIGIN)

    def headers(self, guest, csrf=None, origin=ORIGIN):
        result = {'X-ParaMyth-Guest': guest, 'Origin': origin}
        if csrf:
            result['X-ParaMyth-Token'] = csrf
        return result

    def test_public_config_and_studio_session_need_no_account(self):
        self.assertFalse(self.app.state.account_workspaces)
        self.assertTrue(self.app.state.public_workspaces)
        config = self.a.get('/api/ui/public-config').json()
        self.assertFalse(config['accounts_required'])
        self.assertFalse(config['shared_keys'])
        self.assertFalse(config['github_admin'])
        self.assertEqual(self.a.get('/api/ui/session').status_code, 401)
        session = self.a.get('/api/ui/session', headers=self.headers(self.guest_a))
        self.assertEqual(session.status_code, 200, session.text)
        self.assertEqual(session.json()['user_id'], None)
        self.assertEqual(self.a.post('/api/v1/accounts/signup', json={}).status_code, 404)

    def test_read_only_media_urls_accept_guest_id_without_custom_headers(self):
        response = self.a.get('/api/ui/session', headers=self.headers(self.guest_a))
        media = self.a.get('/media/images/missing/0.png', params={'guest_id': self.guest_a})
        self.assertNotEqual(media.status_code, 401)
        stream = self.a.get('/api/ui/creative/jobs/missing/events', params={'guest_id': self.guest_a})
        self.assertEqual(stream.status_code, 404)

    def test_guest_projects_are_writable_and_isolated(self):
        session_a = self.a.get('/api/ui/session', headers=self.headers(self.guest_a)).json()
        session_b = self.b.get('/api/ui/session', headers=self.headers(self.guest_b)).json()
        created = self.a.post('/api/ui/projects', json={'project': author_project('Guest story')},
                              headers=self.headers(self.guest_a, session_a['csrf']))
        self.assertEqual(created.status_code, 200, created.text)
        self.assertEqual(self.b.get('/api/ui/workspace', headers=self.headers(self.guest_b)).json()['projects'], [])
        self.assertEqual(self.a.get('/api/ui/workspace', headers=self.headers(self.guest_a)).json()['projects'][0]['title'], 'Guest story')
        wrong_guest_token = self.a.post('/api/ui/projects', json={'project': author_project('Wrong token')},
                                        headers=self.headers(self.guest_b, session_a['csrf']))
        self.assertEqual(wrong_guest_token.status_code, 403)
        wrong_token = self.a.post('/api/ui/projects', json={'project': author_project('Wrong token')},
                                  headers=self.headers(self.guest_a, session_b['csrf']))
        self.assertEqual(wrong_token.status_code, 403)

    def test_cross_origin_writes_and_missing_guest_identity_are_rejected(self):
        self.assertEqual(self.a.get('/api/ui/workspace').status_code, 401)
        session = self.a.get('/api/ui/session', headers=self.headers(self.guest_a)).json()
        response = self.a.post('/api/ui/projects', json={'project': author_project()},
                               headers=self.headers(self.guest_a, session['csrf'], 'https://attacker.example'))
        self.assertEqual(response.status_code, 403)
        preflight = self.a.options('/api/ui/session', headers={
            'Origin': 'https://paramyth.tech',
            'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'x-paramyth-guest',
        })
        self.assertEqual(preflight.status_code, 200)
        self.assertIn('x-paramyth-guest', preflight.headers['access-control-allow-headers'].lower())


if __name__ == '__main__':
    unittest.main()
