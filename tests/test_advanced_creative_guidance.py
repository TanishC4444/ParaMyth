"""Creative guidance contracts, with a mocked provider and no paid calls."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from paramyth.pipeline import creative_studio
from paramyth.pipeline.production_research import ProviderError


class CreativeGuidanceTests(unittest.TestCase):
    def run_idea(self, raw, result):
        response = {'choices': [{'message': {'content': json.dumps(result)}, 'finish_reason': 'stop'}], 'usage': {'total_tokens': 12}}
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'VULTR_INFERENCE_API_KEY': 'test-only'}):
            with patch('paramyth.pipeline.creative_studio.request_json', return_value=response) as provider:
                record = creative_studio.run(Path(directory), {**raw, 'use_story': False})
            persisted = json.loads((Path(directory) / 'creative' / (record['id'] + '.json')).read_text(encoding='utf-8'))
        return record, persisted, provider

    def test_short_brief_accepts_unspecified_structure_and_preserves_provider_choices(self):
        result = {'title': 'The letters', 'text': 'A keeper receives letters from tomorrow.',
                  'completed_brief': {'structure': 'A reverse chronology', 'pov': 'First person'},
                  'assumptions': ['The keeper narrates in first person.'],
                  'suggestions': [{'suggestion': 'Give the letters a personal cost.', 'reason': 'Clarifies the stakes.'}]}
        record, saved, provider = self.run_idea({'operation': 'ideas', 'brief': 'Letters from tomorrow'}, result)
        self.assertEqual(provider.call_count, 1)
        request = provider.call_args.args[1]
        user = json.loads(request['messages'][1]['content'])
        self.assertEqual(user['author_brief'], 'Letters from tomorrow')
        self.assertEqual(user['author_structure'], '')
        self.assertEqual(user['guidance_mode'], 'suggest')
        self.assertIn('Do not require a conventional three-act structure', request['messages'][0]['content'])
        self.assertIn('Suggestions are not', request['messages'][0]['content'])
        self.assertEqual(saved['result'], result)
        self.assertEqual(record['steps'][0]['usage'], {'total_tokens': 12})

    def test_use_idea_keeps_author_constraints_and_structure_in_provider_request(self):
        result = {'title': 'Two voices', 'text': 'The original premise developed.',
                  'completed_brief': {'structure': 'Two interleaved timelines'},
                  'assumptions': ['The missing setting is an island.'], 'suggestions': []}
        record, _, provider = self.run_idea({'operation': 'ideas', 'brief': 'No romance. Two narrators. An unresolved ending.',
                                          'guidance_mode': 'use_idea', 'structure': 'Two interleaved timelines'}, result)
        request = provider.call_args.args[1]
        user = json.loads(request['messages'][1]['content'])
        self.assertEqual(user['guidance_mode'], 'use_idea')
        self.assertEqual(user['author_structure'], 'Two interleaved timelines')
        self.assertEqual(user['author_brief'], 'No romance. Two narrators. An unresolved ending.')
        self.assertIn('Do not replace', request['messages'][0]['content'])
        self.assertIn('Use an empty suggestions array for use_idea', request['messages'][0]['content'])
        self.assertEqual(record['request']['structure'], 'Two interleaved timelines')
        self.assertEqual(record['result']['suggestions'], [])

    def test_ideas_can_start_without_a_complete_brief(self):
        cfg = creative_studio.validate({'operation': 'ideas'})
        self.assertEqual(cfg['brief'], '')
        self.assertEqual(cfg['structure'], '')
        self.assertEqual(cfg['guidance_mode'], 'suggest')
        self.assertEqual(creative_studio.validate(cfg), cfg)

    def test_invalid_guidance_and_structure_fail_before_provider_call(self):
        for raw in ({'guidance_mode': 'overwrite_everything'}, {'structure': ['three acts']}, {'structure': 'x' * 60001}):
            with self.subTest(raw=str(raw)[:60]), patch('paramyth.pipeline.creative_studio.request_json') as provider:
                with self.assertRaises(ValueError):
                    creative_studio.run(Path('unused'), raw)
                provider.assert_not_called()

    def test_provider_failure_has_no_fabricated_result_or_automatic_retry(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'VULTR_INFERENCE_API_KEY': 'test-only'}):
            with patch('paramyth.pipeline.creative_studio.request_json', side_effect=ProviderError('Provider unavailable')) as provider:
                with self.assertRaisesRegex(ProviderError, 'Provider unavailable'):
                    creative_studio.run(Path(directory), {'operation': 'ideas', 'brief': 'One sentence', 'use_story': False})
            self.assertEqual(provider.call_count, 1)
            records = list((Path(directory) / 'creative').glob('*.json'))
            self.assertEqual(len(records), 1)
            value = json.loads(records[0].read_text(encoding='utf-8'))
            self.assertEqual(value['status'], 'failed')
            self.assertNotIn('result', value)


class CreativeAdoptionTests(unittest.TestCase):
    def setUp(self):
        from fastapi import FastAPI
        from fastapi.responses import JSONResponse
        from fastapi.testclient import TestClient
        from paramyth.pipeline.api.studio_runtime import StudioRuntime
        from paramyth.pipeline.api.studio_routes import get_runtime
        from paramyth.pipeline.api.ui_workspace import router
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        source = self.root / 'outputs' / 'author'
        source.mkdir(parents=True)
        (source / 'story.txt').write_text('Original manuscript. Do not change.', encoding='utf-8')
        self.runtime = StudioRuntime(self.root)
        self.addCleanup(self.runtime.pool.shutdown)
        self.source_id = self.runtime.project_id(source)
        self.source = source
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[get_runtime] = lambda: self.runtime
        @self.app.exception_handler(ValueError)
        async def invalid(_, exc):
            return JSONResponse({'detail': str(exc)}, status_code=422)
        @self.app.exception_handler(FileNotFoundError)
        async def missing(_, exc):
            return JSONResponse({'detail': 'Missing record'}, status_code=404)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.headers = {'X-ParaMyth-Token': self.runtime.token}
        self.record_id = 'a' * 24

    def save_record(self, result, status='complete'):
        from paramyth.pipeline.storage import save
        self.record = {'id': self.record_id, 'status': status, 'request': {'operation': 'ideas'}, 'result': result}
        save(self.source / 'creative' / (self.record_id + '.json'), self.record)

    def adopt(self, project_id=None, **kwargs):
        return self.client.post('/api/ui/creative/' + self.record_id + '/use-as-project',
                                params={'project_id': project_id or self.source_id}, json={}, headers=self.headers, **kwargs)

    def test_adoption_preserves_completed_brief_decisions_and_original_text(self):
        text = 'A keeper reads tomorrow’s letter.\n\nShe chooses to leave the final letter unopened.'
        brief = {'premise': 'Letters arrive from tomorrow.', 'medium': 'short_story', 'genre': 'Speculative',
                 'tone': 'Restrained', 'pov': 'First person', 'themes': ['Choice'], 'worldRules': ['Letters never lie.'],
                 'mustAvoid': ['Romance'], 'structure': 'Two interleaved timelines', 'stakes': 'An island loses its future.',
                 'ending_direction': 'Unresolved', 'characters': [{'name': 'Mara', 'pronouns': 'she/her', 'goal': 'Protect the island',
                 'fear': 'Becoming a tool of fate', 'voice': 'Dry', 'arc': {'belief': 'Fate is fixed', 'pressure': 'One letter fails',
                 'choice': 'Leave a letter unopened', 'change': 'Accept uncertainty'}}]}
        self.save_record({'title': 'Tomorrow’s Keeper', 'text': text, 'completed_brief': brief,
                          'assumptions': ['The keeper lives on an island.'], 'suggestions': []})
        response = self.adopt()
        self.assertEqual(response.status_code, 200, response.text)
        p = response.json()['project']
        self.assertNotEqual(p['id'], self.source_id)
        self.assertEqual(p['brief']['medium'], 'Short story')
        self.assertEqual(p['brief']['premise'], brief['premise'])
        self.assertEqual(p['brief']['structure'], brief['structure'])
        self.assertEqual(p['brief']['characters'][0]['arc']['choice'], 'Leave a letter unopened')
        self.assertEqual(p['scenes'][0]['content'], text)
        self.assertEqual(p['scenes'][0]['state'], 'Draft')
        self.assertEqual(p['canon'], [])
        target = self.runtime.folder(p['id'])
        self.assertEqual((target / 'author-draft.txt').read_text(encoding='utf-8'), text)
        req = json.loads((target / 'request.json').read_text(encoding='utf-8'))
        self.assertEqual(req['medium'], 'short_story')
        self.assertEqual(req['tone_mood'], 'Restrained')
        self.assertEqual(req['must_avoid'], ['Romance'])
        self.assertEqual(req['ending_direction'], 'Unresolved')
        self.assertEqual(req['characters'][0]['pronouns'], 'she/her')
        self.assertEqual(req['characters'][0]['arc']['costly_choice'], 'Leave a letter unopened')
        self.assertEqual(req['creative_source']['completed_brief'], brief)
        self.assertEqual(json.loads((target / 'creative-source.json').read_text(encoding='utf-8')), self.record)
        self.assertEqual((self.source / 'story.txt').read_text(encoding='utf-8'), 'Original manuscript. Do not change.')
        self.assertNotIn('set-cookie', response.headers)

    def test_legacy_result_remains_usable_without_invented_characters(self):
        self.save_record({'title': 'Old idea', 'text': 'An existing saved idea.'})
        response = self.adopt()
        self.assertEqual(response.status_code, 200, response.text)
        p = response.json()['project']
        self.assertEqual(p['brief']['premise'], 'An existing saved idea.')
        self.assertEqual(p['brief']['characters'], [])
        self.assertEqual(p['scenes'][0]['content'], 'An existing saved idea.')
        self.assertEqual(p['creative_source']['completed_brief'], {})

    def test_project_scope_and_csrf_prevent_unintended_adoption(self):
        self.save_record({'title': 'Idea', 'text': 'A complete idea.'})
        other = self.runtime.create_project('Other story', 'Unrelated text')
        self.assertEqual(self.adopt(other).status_code, 404)
        before = len(self.runtime.projects)
        response = self.client.post('/api/ui/creative/' + self.record_id + '/use-as-project', json={})
        self.assertEqual(response.status_code, 403)
        self.save_record({'title': 'Incomplete', 'text': 'Partial result'}, status='running')
        self.assertEqual(self.adopt().status_code, 422)
        self.assertEqual(len(self.runtime.projects), before)


if __name__ == '__main__':
    unittest.main()
