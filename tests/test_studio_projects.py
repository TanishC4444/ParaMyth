"""Studio API foundations: local-only access, write tokens, projects and jobs."""
import json
from pathlib import Path
import tempfile
import time
import unittest

try:
    from fastapi.testclient import TestClient
    from paramyth.studio.app import create_app
    from paramyth.studio.runtime import Runtime
except ImportError:  # The studio is an optional extra: pip install -e '.[studio]'
    TestClient = None


def wait(runtime, ident, timeout=5):
    deadline = time.time() + timeout
    while runtime.job(ident)['status'] in ('queued', 'running'):
        if time.time() > deadline:
            raise AssertionError('job did not finish')
        time.sleep(.01)
    return runtime.job(ident)


@unittest.skipIf(TestClient is None, 'studio extra not installed')
class StudioTestCase(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.app = create_app(self.root, frontend=None)
        self.runtime = self.app.state.runtime
        self.addCleanup(self.runtime.close)
        self.client = TestClient(self.app)
        self.token = self.client.get('/api/ui/session').json()['csrf']

    def post(self, path, body=None, **kwargs):
        return self.client.post(path, json=body or {}, headers={'X-ParaMyth-Token': self.token}, **kwargs)

    def project(self, title='Harbor', text='Wind and rain crossed the harbor.', brief=None):
        return self.runtime.create_project(title, text, brief)


class StudioProjectTests(StudioTestCase):
    def test_session_token_is_not_cached_and_health_is_open(self):
        response = self.client.get('/api/ui/session')
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(response.json()['header'], 'X-ParaMyth-Token')
        self.assertEqual(self.client.get('/api/v1/health').json(), {'status': 'ok'})

    def test_writes_need_the_token_and_a_same_origin(self):
        body = {'title': 'Harbor', 'text': 'A story'}
        self.assertEqual(self.client.post('/api/studio/projects', json=body).status_code, 403)
        self.assertEqual(self.client.post('/api/studio/projects', json=body, headers={'X-ParaMyth-Token': 'wrong'}).status_code, 403)
        foreign = self.client.post('/api/studio/projects', json=body, headers={'X-ParaMyth-Token': self.token, 'Origin': 'https://evil.example'})
        self.assertEqual(foreign.status_code, 403)
        self.assertEqual(self.post('/api/studio/projects', body).status_code, 200)

    def test_remote_hosts_are_refused(self):
        remote = TestClient(self.app, base_url='http://studio.example.com')
        self.assertEqual(remote.get('/api/studio/projects').status_code, 403)
        self.assertEqual(remote.get('/api/ui/session').status_code, 403)

    def test_projects_are_created_selected_and_listed(self):
        self.assertEqual(self.client.get('/api/studio/projects').status_code, 422)
        created = self.post('/api/studio/projects', {'title': 'Harbor', 'text': 'Rain'})
        ident = created.json()['id']
        self.assertIn('paramyth_project', created.headers['set-cookie'])
        other = self.project('Forge', 'Sparks')
        listing = self.client.get('/api/studio/projects').json()
        self.assertEqual({p['title'] for p in listing['projects']}, {'Harbor', 'Forge'})
        self.assertEqual(self.post('/api/studio/project/select', {'id': other}).json(), {'id': other})
        self.assertEqual(self.client.get('/api/studio/projects').json()['current'], other)
        self.assertEqual(self.post('/api/studio/project/select', {'id': 'missing'}).status_code, 422)
        story = (self.runtime.folder(ident) / 'story.txt').read_text()
        self.assertEqual(story, 'Harbor\n\nRain')
        for bad in ({'title': '', 'text': 'x'}, {'title': 'x' * 151, 'text': 'x'}, {'title': 'x', 'text': ''}):
            self.assertEqual(self.post('/api/studio/projects', bad).status_code, 422)

    def test_jobs_report_results_failures_and_project_scope(self):
        mine, other = self.project(), self.project('Forge')
        ok = self.runtime.submit('production', self.runtime.folder(mine), lambda progress: progress('Planning') or {'id': 'plan1'})
        bad = self.runtime.submit('creative', self.runtime.folder(mine), lambda progress: (_ for _ in ()).throw(ValueError('No key')))
        crash = self.runtime.submit('creative', self.runtime.folder(other), lambda progress: 1 / 0)
        for ident in (ok, bad, crash):
            wait(self.runtime, ident)
        self.assertEqual(self.client.get('/api/job/' + ok).json()['plan_id'], 'plan1')
        self.assertEqual(self.client.get('/api/job/' + bad).json()['message'], 'No key')
        self.assertIn('Unexpected job failure', self.runtime.job(crash)['message'])
        listed = self.client.get('/api/studio/jobs', params={'project_id': mine}).json()['jobs']
        self.assertEqual({j['id'] for j in listed}, {ok, bad})
        self.assertEqual(self.client.get('/api/job/missing').status_code, 422)

    def test_restart_marks_unfinished_jobs_interrupted(self):
        ident = self.project()
        job = {'id': 'a' * 24, 'kind': 'music', 'project_id': ident, 'status': 'running', 'created_at': 'now', 'message': 'Working'}
        (self.runtime.job_dir / (job['id'] + '.json')).write_text(json.dumps(job))
        restarted = Runtime(self.root)
        self.addCleanup(restarted.close)
        self.assertEqual(restarted.job(job['id'])['status'], 'interrupted')

    def test_active_jobs_are_capped(self):
        ident = self.project()
        with self.runtime.guard:
            for i in range(4):
                self.runtime.jobs[str(i)] = {'id': str(i), 'status': 'running', 'project_id': ident, 'created_at': 'now'}
        with self.assertRaisesRegex(ValueError, 'Four jobs'):
            self.runtime.submit('creative', self.runtime.folder(ident), lambda progress: None)

    def test_features_report_configuration_without_secret_values(self):
        value = self.client.get('/api/studio/features').json()
        self.assertEqual(set(value['configured']), {'vultr', 'muse_image', 'serpapi', 'google_oauth', 'github_server_token'})
        self.assertTrue(all(isinstance(v, bool) for v in value['configured'].values()))


if __name__ == '__main__':
    unittest.main()
