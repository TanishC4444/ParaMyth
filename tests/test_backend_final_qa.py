"""Regression checks from the final backend QA pass."""
import os
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import test_team_workspaces as teams
from test_studio_projects import StudioTestCase, wait
from paramyth.storage import load
from paramyth.providers import NoRedirect


class SponsorTransportTests(unittest.TestCase):
    def test_explicit_local_ambience_does_not_need_provider_model_discovery(self):
        from paramyth.pipeline.media_workspace import create_music
        from paramyth.storage import save
        with tempfile.TemporaryDirectory() as root:
            save(Path(root) / 'story.txt', 'Rain crossed the harbor.')
            with patch('paramyth.pipeline.media_workspace.music_models', side_effect=AssertionError('Unnecessary provider call')):
                result = create_music(root, {'prompt': 'Rain only', 'mode': 'ambience', 'seconds': 5}, lambda _: None)
            self.assertEqual(result['provider'], 'local procedural')
            self.assertEqual((Path(root) / 'soundtracks' / result['file']).read_bytes()[:4], b'RIFF')

    def test_music_requests_disable_redirects_and_bound_json(self):
        from paramyth.pipeline.soundtracks import Vultr
        with patch.dict(os.environ, {'VULTR_MUSIC_API_KEY': 'qa-music-key'}):
            provider = Vultr()
        for raw in (b'[]', b'{invalid', b'x' * (1024 * 1024 + 1)):
            with self.subTest(raw_bytes=len(raw)), patch('paramyth.pipeline.soundtracks.build_opener') as opener:
                opener.return_value.open.return_value = io.BytesIO(raw)
                with self.assertRaises(ValueError):
                    provider.json('/music/models')
                self.assertIsInstance(opener.call_args.args[0], NoRedirect)
                opener.return_value.open.assert_called_once()
                request = opener.return_value.open.call_args.args[0]
                self.assertEqual(request.get_header('Authorization'), 'Bearer qa-music-key')

    def test_writing_requests_disable_redirects_without_retrying(self):
        from urllib.error import HTTPError
        from paramyth.pipeline.creative_stream import completion, StreamError
        with patch.dict(os.environ, {'VULTR_INFERENCE_API_KEY': 'qa-writing-key'}), \
                patch('paramyth.pipeline.creative_stream.build_opener') as opener:
            opener.return_value.open.side_effect = HTTPError('https://provider.invalid', 302, 'redirect', {}, io.BytesIO())
            with self.assertRaisesRegex(StreamError, 'HTTP 302'):
                completion('Vultr Serverless Inference', 'muse-glimmer-30b', [{'content': 'system'}, {'content': 'prompt'}], .2, lambda _: None)
            self.assertIsInstance(opener.call_args.args[0], NoRedirect)
            opener.return_value.open.assert_called_once()


class BackendInputTests(StudioTestCase):
    def setUp(self):
        super().setUp()
        self.ident = self.project()

    def test_invalid_selection_preserves_current_project(self):
        for body in ({}, {'id': None}, {'id': ''}, {'id': []}, {'id': {}}, {'id': 1}):
            with self.subTest(body=body):
                self.assertEqual(self.post('/api/studio/project/select', body).status_code, 422)
        self.assertEqual(self.client.get('/api/studio/projects').json()['current'], self.ident)

    def test_invalid_notes_cannot_replace_saved_notes_or_break_requests(self):
        route = '/api/ui/notes'
        headers = {'X-ParaMyth-Token': self.token}
        good = {'ideas': ['Keep this idea'], 'pins': [{'projectId': self.ident, 'recordId': 'work_001'}]}
        self.assertEqual(self.client.put(route, json=good, headers=headers).status_code, 200)
        for body in ({'pins': [None]}, {'pins': [{}]}, {'pins': 'bad'}, {'pins': [{'projectId': self.ident}]},
                     {'ideas': None}, {'ideas': [1]}, {'pins': [{'projectId': self.ident, 'recordId': 'work_001', 'purpose': []}]}):
            with self.subTest(body=body):
                self.assertEqual(self.client.put(route, json=body, headers=headers).status_code, 422)
        self.assertEqual(load(self.runtime.root / 'runs' / 'paramyth-workspace.json'), good)
        self.assertEqual(self.client.get(f'/api/ui/projects/{self.ident}/request').status_code, 200)

    def test_missing_plan_is_404_across_reads_exports_and_mutations(self):
        ident = 'a' * 24
        for route in (f'/api/plan/{ident}', f'/export/{ident}/calendar.ics'):
            self.assertEqual(self.client.get(route).status_code, 404, route)
        for route in ('/api/recalculate', '/api/calendar-sync'):
            self.assertEqual(self.post(route, {'id': ident}).status_code, 404, route)

    def test_project_lookup_accepts_paths_through_a_symlink(self):
        from paramyth.studio.runtime import Runtime
        from paramyth.pipeline.api.studio_runtime import StudioRuntime
        with tempfile.TemporaryDirectory() as temp:
            alias = Path(temp) / 'workspace'
            alias.symlink_to(self.root.resolve(), target_is_directory=True)
            folder = self.runtime.folder(self.ident)
            aliased = alias / folder.relative_to(self.root.resolve())
            for cls in (Runtime, StudioRuntime):
                runtime = cls(self.root)
                try:
                    self.assertEqual(runtime.project_id(aliased), runtime.project_id(folder))
                finally:
                    runtime.pool.shutdown()


@unittest.skipUnless(os.getenv('PARAMYTH_TEST_DATABASE_URL'), 'Set a disposable PostgreSQL URL')
class HostedBackendTests(unittest.TestCase):
    setUp = teams.TeamWorkspaceTests.setUp
    tearDown = teams.TeamWorkspaceTests.tearDown
    make_app = teams.TeamWorkspaceTests.make_app
    client = teams.TeamWorkspaceTests.client
    signup = teams.TeamWorkspaceTests.signup
    headers = teams.TeamWorkspaceTests.headers
    project = teams.TeamWorkspaceTests.project
    invite = teams.TeamWorkspaceTests.invite
    url = teams.TeamWorkspaceTests.url
    shared = teams.TeamWorkspaceTests.shared

    def test_every_workspace_mutation_rejects_viewers_and_outsiders(self):
        p = self.shared(self.a)
        checked = 0
        for client, status in ((self.v, 403), (self.o, 404)):
            headers = self.headers(client)
            for route, methods in self.app.openapi()['paths'].items():
                if route.startswith('/api/v1/') or route == '/api/studio/project/select':
                    continue
                for method in methods:
                    if method not in ('post', 'put', 'patch', 'delete'):
                        continue
                    path = route.replace('{ident}', p['id']).replace('{index}', '0')
                    response = client.request(method, self.url(path, project_id=p['id']), json={}, headers=headers)
                    self.assertEqual(response.status_code, status, (method, path, response.text))
                    checked += 1
        self.assertGreaterEqual(checked, 30)

    def test_hosted_invalid_inputs_preserve_saved_state(self):
        p = self.shared(self.b)
        headers = self.headers(self.b)
        for path, body in [('/api/ui/production', {'config': []}),
                           ('/api/ui/production/prepare', {'config': None}),
                           ('/api/ui/images/prepare', {'source': []}),
                           ('/api/studio/project/select', {'id': []}),
                           ('/api/ui/music', {'mode': 'ambience', 'seconds': {}}),
                           ('/api/ui/music', {'mode': 'ambience', 'seconds': True}),
                           ('/api/ui/music', {'prompt': []})]:
            result = self.b.post(self.url(path, project_id=p['id']), json=body, headers=headers)
            self.assertEqual(result.status_code, 422, (path, result.text))
        self.assertEqual(self.b.put(self.url('/api/ui/notes'), json={'pins': [None]}, headers=headers).status_code, 422)
        self.assertEqual(self.b.get(self.url(f'/api/ui/projects/{p["id"]}/request')).status_code, 200)

    def test_admin_editor_media_and_production_outputs_remain_team_scoped(self):
        from test_studio_planning import BREAKDOWN, ADVICE, reply
        from test_images import response
        admin, admin_user = self.signup('admin')
        self.invite(admin, admin_user, 'admin')
        p = self.shared(admin)
        headers = self.headers(self.b)
        with patch.dict(os.environ, {'MUSE_IMAGE_API_KEY': 'qa-image-key'}), \
                patch('paramyth.image_studio.request_json', return_value=response()):
            result = self.b.post(self.url('/api/images/generate', project_id=p['id']),
                                 json={'model': 'muse-image-1.0', 'prompt': 'A harbor bell', 'kind': 'scene', 'title': 'Bell'}, headers=headers)
            self.assertEqual(result.status_code, 202, result.text)
            runtime = self.app.state.workspaces.for_studio(self.bu['id'], self.studio)
            self.assertEqual(wait(runtime, result.json()['job_id'])['status'], 'complete')
        result = self.b.post(self.url('/api/studio/music', project_id=p['id']),
                             json={'mode': 'ambience', 'seconds': 5, 'direction': 'Rain'}, headers=headers)
        self.assertEqual(result.status_code, 202, result.text)
        track = wait(runtime, result.json()['job_id'])
        self.assertEqual(track['status'], 'complete', track)
        audio = self.url(f'/media/music/{track["result"]["id"]}/content', project_id=p['id'])
        with patch.dict(os.environ, {'VULTR_INFERENCE_API_KEY': '', 'VULTR_PRODUCTION_API_KEY': 'qa-production-key'}), \
                patch('paramyth.pipeline.production.request_json', side_effect=[reply(BREAKDOWN), reply(ADVICE)]) as provider:
            result = self.b.post(self.url('/api/generate', project_id=p['id']), json={'config': {'start_date': '2026-11-02'}}, headers=headers)
            self.assertEqual(result.status_code, 202, result.text)
            plan = wait(runtime, result.json()['job_id'])
            self.assertEqual(plan['status'], 'complete', plan)
            self.assertEqual(provider.call_args.args[2]['Authorization'], 'Bearer qa-production-key')
        for client in (self.a, admin, self.b, self.v):
            self.assertEqual(client.get(audio).content[:4], b'RIFF')
            for kind in ('calendar.ics', 'schedule.csv', 'budget.csv', 'tasks.csv', 'call-sheets.txt', 'plan.json'):
                export = self.url(f'/export/{plan["result"]["id"]}/{kind}', project_id=p['id'])
                self.assertEqual(client.get(export).status_code, 200, kind)
                self.assertEqual(self.o.get(export).status_code, 404, kind)
        self.assertEqual(self.o.get(audio).status_code, 404)
