"""Serving the built frontend and the API from one local origin."""
from pathlib import Path
import tempfile
import unittest

from test_studio_projects import StudioTestCase, TestClient


class ServeTests(StudioTestCase):
    def test_built_frontend_is_served_beside_the_api(self):
        from paramyth.studio.app import create_app
        with tempfile.TemporaryDirectory() as dist:
            (Path(dist) / 'index.html').write_text('<!doctype html><title>ParaMyth</title>')
            (Path(dist) / 'assets').mkdir()
            (Path(dist) / 'assets' / 'app.js').write_text('console.log(1)')
            app = create_app(self.root, frontend=dist)
            self.addCleanup(app.state.runtime.close)
            client = TestClient(app)
            self.assertIn('ParaMyth', client.get('/').text)
            self.assertEqual(client.get('/assets/app.js').text, 'console.log(1)')
            self.assertEqual(client.get('/api/v1/health').json(), {'status': 'ok'})
            page = client.get('/studio/teams.html?mode=signup')
            self.assertEqual(page.status_code, 200)
            self.assertIn('id="account-form"', page.text)
            self.assertEqual(client.get('/studio/js/teams.js').status_code, 200)
            self.check_account_assets(client)

    def test_account_page_is_available_without_frontend_build(self):
        self.assertEqual(self.client.get('/studio/teams.html?mode=signup').status_code, 200)
        self.assertIn('/accounts/${mode}', self.client.get('/studio/js/teams.js').text)
        self.check_account_assets(self.client)

    def check_account_assets(self, client):
        for path, media_type in [('/art/castle.webp', 'image/webp'),
                                 ('/art/paper.webp', 'image/webp'),
                                 ('/brand/paramyth-logo.png', 'image/png'),
                                 ('/favicon.ico', 'image/svg+xml')]:
            with self.subTest(path=path):
                response = client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers['content-type'], media_type)
                self.assertTrue(response.content)

    def test_without_a_build_only_the_api_answers(self):
        self.assertEqual(self.client.get('/').status_code, 404)
        self.assertEqual(self.client.get('/api/v1/health').status_code, 200)


if __name__ == '__main__':
    unittest.main()
