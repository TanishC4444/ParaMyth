"""Creative studio contracts, with a mocked provider and no paid calls."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from paramyth import creative
from paramyth.providers import ProviderError

KEY = {'VULTR_INFERENCE_API_KEY': 'test-only'}


def reply(result, tokens=12):
    return {'choices': [{'message': {'content': json.dumps(result)}, 'finish_reason': 'stop'}], 'usage': {'total_tokens': tokens}}


class CreativeTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.folder = Path(temp.name)

    def run_with(self, raw, *results):
        with patch.dict(os.environ, KEY), patch('paramyth.vultr.request_json', side_effect=[reply(r) for r in results]) as provider:
            record = creative.run(self.folder, {'use_story': False, **raw})
        saved = json.loads((self.folder / 'creative' / (record['id'] + '.json')).read_text(encoding='utf-8'))
        return record, saved, provider

    def test_short_brief_accepts_unspecified_structure_and_preserves_provider_choices(self):
        result = {'title': 'The letters', 'text': 'A keeper receives letters from tomorrow.',
                  'completed_brief': {'structure': 'A reverse chronology'}, 'assumptions': ['First person.'],
                  'suggestions': [{'suggestion': 'Give the letters a cost.', 'reason': 'Clarifies stakes.'}]}
        record, saved, provider = self.run_with({'operation': 'ideas', 'brief': 'Letters from tomorrow'}, result)
        request = provider.call_args.args[1]
        user = json.loads(request['messages'][1]['content'])
        self.assertEqual((user['author_brief'], user['author_structure'], user['guidance_mode']), ('Letters from tomorrow', '', 'suggest'))
        self.assertIn('Do not require a conventional three-act structure', request['messages'][0]['content'])
        self.assertEqual(saved['result'], result)
        self.assertEqual(record['steps'][0]['usage'], {'total_tokens': 12})
        self.assertEqual((self.folder / 'creative' / (record['id'] + '.txt')).read_text(encoding='utf-8'), result['text'])

    def test_use_idea_keeps_author_constraints_and_structure(self):
        result = {'title': 'Two voices', 'text': 'Developed.', 'completed_brief': {}, 'assumptions': [], 'suggestions': []}
        record, _, provider = self.run_with({'operation': 'ideas', 'brief': 'No romance. Two narrators.',
                                             'guidance_mode': 'use_idea', 'structure': 'Two timelines'}, result)
        request = provider.call_args.args[1]
        user = json.loads(request['messages'][1]['content'])
        self.assertEqual((user['guidance_mode'], user['author_structure']), ('use_idea', 'Two timelines'))
        self.assertIn('Use an empty suggestions array for use_idea', request['messages'][0]['content'])
        self.assertEqual(record['request']['structure'], 'Two timelines')

    def test_loop_stops_when_critic_passes(self):
        draft = {'title': 'T', 'text': 'First draft.', 'assumptions': []}
        revised = {'title': 'T', 'text': 'Better draft.', 'assumptions': []}
        record, _, provider = self.run_with({'operation': 'loop', 'rounds': 3}, draft,
                                            {'pass': False, 'summary': 'Thin', 'issues': []}, revised,
                                            {'pass': True, 'summary': 'Good', 'issues': []})
        self.assertEqual(provider.call_count, 4)
        self.assertEqual([s['stage'] for s in record['steps']], ['Draft', 'Review', 'Revise', 'Review'])
        self.assertEqual(record['result'], revised)
        self.assertTrue(record['review_matches_result'])

    def test_invalid_requests_fail_before_provider_call(self):
        for raw in ({'guidance_mode': 'overwrite'}, {'structure': ['three acts']}, {'structure': 'x' * 60001},
                    {'operation': 'review'}, {'rounds': 4}, {'words': 50}, {'operation': 'publish'}):
            with self.subTest(raw=str(raw)[:40]), patch('paramyth.vultr.request_json') as provider:
                with self.assertRaises(ValueError):
                    creative.run(self.folder, raw)
                provider.assert_not_called()

    def test_missing_key_fails_before_any_record(self):
        with patch.dict(os.environ, {'VULTR_INFERENCE_API_KEY': ''}), self.assertRaisesRegex(ProviderError, 'VULTR_INFERENCE_API_KEY'):
            creative.run(self.folder, {'operation': 'ideas', 'use_story': False})
        self.assertFalse((self.folder / 'creative').exists())

    def test_provider_failure_has_no_fabricated_result_or_retry(self):
        with patch.dict(os.environ, KEY), patch('paramyth.vultr.request_json', side_effect=ProviderError('Provider unavailable')) as provider:
            with self.assertRaisesRegex(ProviderError, 'Provider unavailable'):
                creative.run(self.folder, {'operation': 'ideas', 'brief': 'One sentence', 'use_story': False})
        self.assertEqual(provider.call_count, 1)
        saved = json.loads(next((self.folder / 'creative').glob('*.json')).read_text(encoding='utf-8'))
        self.assertEqual(saved['status'], 'failed')
        self.assertNotIn('result', saved)

    def test_streamed_draft_persists_partial_text_before_and_after_failure(self):
        for fail in (False, True):
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as root:
                folder, updates = Path(root), []

                def provider(messages, on_chunk, **options):
                    on_chunk('{"title":"Story","text":"First words')
                    saved = json.loads(next((folder / 'creative').glob('*.json')).read_text(encoding='utf-8'))
                    self.assertEqual((saved['status'], saved['preview']['text']), ('running', 'First words'))
                    self.assertEqual(updates[-1]['preview']['text'], 'First words')
                    if fail:
                        raise ProviderError('Connection lost')
                    return {'choices': [{'message': {'content': '{"title":"Story","text":"First words finished."}'}, 'finish_reason': 'stop'}]}
                with patch.dict(os.environ, KEY), patch('paramyth.vultr.stream_chat', side_effect=provider) as call:
                    progress = lambda message, **data: updates.append(data)
                    if fail:
                        with self.assertRaises(ProviderError):
                            creative.run(folder, {'operation': 'draft', 'use_story': False}, progress, stream=True)
                    else:
                        creative.run(folder, {'operation': 'draft', 'use_story': False}, progress, stream=True)
                self.assertEqual(call.call_count, 1)
                saved = json.loads(next((folder / 'creative').glob('*.json')).read_text(encoding='utf-8'))
                self.assertEqual(saved['status'], 'failed' if fail else 'complete')
                self.assertEqual('result' in saved, not fail)


if __name__ == '__main__':
    unittest.main()
