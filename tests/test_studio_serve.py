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

    def test_without_a_build_only_the_api_answers(self):
        self.assertEqual(self.client.get('/').status_code, 404)
        self.assertEqual(self.client.get('/api/v1/health').status_code, 200)


if __name__ == '__main__':
    unittest.main()
