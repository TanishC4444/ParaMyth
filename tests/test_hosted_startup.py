import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from fastapi import HTTPException
from fastapi import Request
from fastapi.responses import JSONResponse

from paramyth.studio.server_settings import load_server_environment
from paramyth.studio.hosted import settings
from paramyth.studio.app import create_app


class HostedStartupTests(unittest.TestCase):
    def test_owner_file_loads_keys_without_overwriting_platform_secrets(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'server.env'
            path.write_text('VULTR_PRODUCTION_API_KEY=file-key\nGEMINI_API_KEY=file-gemini\n')
            with patch.dict(os.environ, {'PARAMYTH_ENV_FILE': str(path), 'GEMINI_API_KEY': 'platform-key'}, clear=True):
                load_server_environment()
                self.assertEqual(os.environ['VULTR_PRODUCTION_API_KEY'], 'file-key')
                self.assertEqual(os.environ['GEMINI_API_KEY'], 'platform-key')

    def test_railway_port_and_hostname_are_used_and_missing_volume_is_rejected(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {
            'PORT': '9123', 'RAILWAY_PUBLIC_DOMAIN': 'paramyth-test.up.railway.app',
            'PARAMYTH_WORKSPACE': root,
        }, clear=True):
            port, workspace = settings()
            self.assertEqual(port, 9123)
            self.assertEqual(workspace, Path(root).resolve())
            self.assertEqual(os.environ['PARAMYTH_PUBLIC_ORIGIN'], 'https://paramyth-test.up.railway.app')
            os.environ.pop('PARAMYTH_WORKSPACE')
            with self.assertRaisesRegex(ValueError, 'persistent volume'):
                settings()

    def test_railway_health_hostname_cannot_access_private_routes(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {
            'PARAMYTH_ENCRYPTION_KEY': Fernet.generate_key().decode(),
            'RAILWAY_PROJECT_ID': 'test-project',
        }, clear=True):
            app = create_app(root, frontend=None, public_origin='https://stories.example.tech')
            with TestClient(app) as client, patch('paramyth.studio.hosting.accounts.user', side_effect=HTTPException(401, 'Sign in')) as authenticate:
                self.assertEqual(client.get('https://healthcheck.railway.app/api/v1/health').status_code, 200)
                self.assertEqual(client.get('https://healthcheck.railway.app/api/ui/workspace').status_code, 400)
                self.assertEqual(client.get('https://unrelated.example/api/v1/health').status_code, 400)
                self.assertEqual(client.get('https://stories.example.tech/api/ui/workspace').status_code, 401)
                authenticate.assert_called_once()

    def test_hosted_errors_keep_cors_for_only_the_configured_frontend(self):
        origin = 'https://paramyth.tech'
        backend = 'https://api.example.tech'
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {
            'PARAMYTH_ENCRYPTION_KEY': Fernet.generate_key().decode(),
            'PARAMYTH_FRONTEND_ORIGIN': origin,
        }, clear=True):
            app = create_app(root, frontend=None, public_origin=backend)

            @app.get('/error-probe')
            def error_probe():
                raise RuntimeError('private diagnostic')

            with TestClient(app, base_url=backend, raise_server_exceptions=False) as client:
                for request_origin in (origin, 'https://untrusted.tech'):
                    headers = {'Origin': request_origin}
                    with patch('paramyth.studio.hosting.accounts.user', side_effect=RuntimeError('private diagnostic')):
                        middleware_error = client.get('/api/ui/workspace', headers=headers)
                    with patch('paramyth.studio.hosting.accounts.user', side_effect=HTTPException(401, 'Sign in')):
                        unauthorized = client.get('/api/ui/workspace', headers=headers)
                    route_error = client.get('/error-probe', headers=headers)
                    oversized = client.post('/api/v1/accounts/login', headers=headers, content=b'x' * (5 * 1024 * 1024 + 1))
                    for response, status in ((middleware_error, 500), (route_error, 500), (unauthorized, 401), (oversized, 413)):
                        with self.subTest(origin=request_origin, status=status, path=response.request.url.path):
                            self.assertEqual(response.status_code, status)
                            self.assertNotIn('private diagnostic', response.text)
                            if request_origin == origin:
                                self.assertEqual(response.headers.get('access-control-allow-origin'), origin)
                                self.assertEqual(response.headers.get('access-control-allow-credentials'), 'true')
                                self.assertIn('Origin', response.headers.get('vary', ''))
                            else:
                                self.assertNotIn('access-control-allow-origin', response.headers)

    def test_github_frontend_has_exact_origin_cors_and_secure_cookie_sessions(self):
        from paramyth.studio.accounts import set_session, clear_session
        origin = 'https://paramyth.tech'
        backend = 'https://api.example.tech'
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {
            'PARAMYTH_ENCRYPTION_KEY': Fernet.generate_key().decode(),
            'PARAMYTH_FRONTEND_ORIGIN': origin,
        }, clear=True):
            app = create_app(root, frontend=None, public_origin=backend)

            @app.post('/api/v1/accounts/session-probe')
            def session_probe(request: Request):
                response = JSONResponse({'ok': True})
                set_session(response, request, {'token': 'pm_disposable-test'})
                return response

            @app.post('/api/v1/accounts/logout-probe')
            def logout_probe(request: Request):
                response = JSONResponse({'ok': True})
                clear_session(response, request)
                return response

            with TestClient(app, base_url=backend) as client, patch('paramyth.studio.hosting.accounts.user', return_value={'id':'test'}):
                headers = {'Origin': origin, 'Sec-Fetch-Site': 'cross-site'}
                preflight = client.options('/api/ui/projects', headers={**headers,
                    'Access-Control-Request-Method':'POST', 'Access-Control-Request-Headers':'content-type,x-paramyth-token,x-paramyth-account'})
                self.assertEqual(preflight.status_code, 200)
                self.assertEqual(preflight.headers['access-control-allow-origin'], origin)
                self.assertEqual(preflight.headers['access-control-allow-credentials'], 'true')
                rejected = client.options('/api/ui/workspace', headers={
                    'Origin': 'https://untrusted.tech', 'Access-Control-Request-Method': 'GET'})
                self.assertEqual(rejected.status_code, 400)
                self.assertNotIn('access-control-allow-origin', rejected.headers)
                response = client.post('/api/v1/accounts/session-probe', headers=headers)
                self.assertEqual(response.status_code, 200)
                cookie = response.headers['set-cookie']
                for flag in ('HttpOnly', 'Secure', 'SameSite=none'):
                    self.assertIn(flag, cookie)
                self.assertEqual(client.post('/api/v1/accounts/session-probe', headers={'Origin':'https://untrusted.tech','Sec-Fetch-Site':'cross-site'}).status_code, 403)
                logout = client.post('/api/v1/accounts/logout-probe', headers=headers)
                self.assertIn('SameSite=none', logout.headers['set-cookie'])
                self.assertEqual(client.get('/', follow_redirects=False).headers['location'], origin + '/')
                self.assertEqual(client.get('/studio/teams.html?mode=signup', follow_redirects=False).headers['location'], origin + '/studio/teams.html?mode=signup')


if __name__ == '__main__':
    unittest.main()
