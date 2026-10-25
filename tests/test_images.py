import base64
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
import zlib

from paramyth import image_studio as studio
from paramyth.providers import ProviderError, request_json
from paramyth.visual_direction import art_direction


def png(width=64, height=64):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress((b'\0' + b'\x64\x80\xa0' * width) * height)) + chunk(b'IEND', b''))


def response(blob=None):
    return {'status': 'completed', 'output': [{'type': 'message'},
        {'type': 'image_generation_call', 'status': 'completed',
         'result': base64.b64encode(png() if blob is None else blob).decode()}],
        'usage': {'input_tokens': 20, 'output_tokens': 30, 'total_tokens': 50}}


def settings(**changes):
    return {'model': 'muse-image-1.0', 'prompt': 'A bronze smith at a forge',
            'kind': 'scene', 'title': 'The forge', **changes}


class ImageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'story.txt').write_text('Ancient Troy.\n\nAster is a bronze smith.', encoding='utf-8')
        self.key = patch.dict('os.environ', {'MUSE_IMAGE_API_KEY': 'test-image-key', 'MODEL_API_KEY': ''})
        self.key.start()
        self.addCleanup(self.key.stop)

    def test_local_prompt_preserves_story_and_explicit_style(self):
        with patch.object(studio, 'request_json') as provider:
            packet = studio.prepare_prompt(self.root, {'subject': 'Aster', 'style': 'Oil painting'})
        provider.assert_not_called()
        self.assertIn('bronze smith', packet['prompt'])
        self.assertEqual(packet['sources'], ['story.txt'])
        self.assertEqual(packet['art_direction']['style'], 'Oil painting')
        self.assertLessEqual(len(packet['prompt']), 3500)

    def test_custom_prompt_never_reads_story(self):
        with patch.object(studio, 'context') as reader:
            result = studio.prepare_prompt(self.root, {'kind': 'custom', 'subject': 'A red teapot', 'use_story': False})
        reader.assert_not_called()
        self.assertIn('red teapot', result['prompt'])
        with self.assertRaises(ValueError):
            studio.input_spec({'use_story': False})

    def test_story_subject_can_match_a_late_passage(self):
        text = '\n\n'.join('Unrelated passage ' + str(i) for i in range(100))
        (self.root / 'story.txt').write_text(text + '\n\nAster wears a blue cloak.', encoding='utf-8')
        self.assertIn('Aster wears a blue cloak', studio.prepare_prompt(self.root, {'subject': 'Aster'})['prompt'])

    def test_context_excludes_logs_and_request_credentials(self):
        (self.root / '.env').write_text('SECRET=do-not-send')
        (self.root / 'request.json').write_text(json.dumps({'premise': 'A harbor keeper', 'api_key': 'do-not-send'}))
        (self.root / 'state.json').write_text(json.dumps({'accepted': [], 'provider_key': 'do-not-send'}))
        packet = studio.prepare_prompt(self.root, {'subject': 'harbor'})
        self.assertNotIn('do-not-send', json.dumps(packet))
        self.assertNotIn('.env', packet['sources'])

    def test_author_draft_and_missing_story(self):
        (self.root / 'author-draft.txt').write_text('An original author revision.', encoding='utf-8')
        self.assertEqual(studio.prepare_prompt(self.root, {})['sources'], ['author-draft.txt'])
        with self.assertRaisesRegex(ValueError, 'No story artifacts'):
            studio.prepare_prompt(self.root / 'missing', {})

    def test_prompt_validation_and_enhancement_not_silent(self):
        for raw in ([], {'kind': []}, {'subject': {}}, {'use_story': 'false'}, {'natural_finish': 1}):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                studio.input_spec(raw)
        with patch.dict('os.environ', {'VULTR_INFERENCE_API_KEY': ''}), patch('paramyth.vultr.request_json') as provider:
            with self.assertRaisesRegex(ProviderError, 'VULTR_INFERENCE_API_KEY'):
                studio.prepare_prompt(self.root, {}, enhance=True)
        provider.assert_not_called()

    def test_enhanced_prompt_comes_from_vultr_with_story_evidence(self):
        reply = {'choices': [{'message': {'content': json.dumps({'prompt': 'A smith at a bronze forge, dusk light', 'title': 'The forge',
                                                                 'assumptions': ['Dusk light is invented']})}, 'finish_reason': 'stop'}],
                 'usage': {'total_tokens': 30}}
        with patch.dict('os.environ', {'VULTR_INFERENCE_API_KEY': 'test-key'}), patch('paramyth.vultr.request_json', return_value=reply) as provider:
            result = studio.prepare_prompt(self.root, {'subject': 'forge'}, enhance=True)
        sent = json.loads(provider.call_args.args[1]['messages'][1]['content'])
        self.assertEqual(sent['request']['subject'], 'forge')
        self.assertTrue(sent['story_excerpts'])
        self.assertEqual((result['prompt'], result['prompt_provider']), ('A smith at a bronze forge, dusk light', 'Vultr Muse Glimmer'))
        self.assertEqual(result['model_calls'][0]['usage'], {'total_tokens': 30})
        bad = {'choices': [{'message': {'content': '{"prompt": ""}'}, 'finish_reason': 'stop'}]}
        with patch.dict('os.environ', {'VULTR_INFERENCE_API_KEY': 'test-key'}), patch('paramyth.vultr.request_json', return_value=bad):
            with self.assertRaisesRegex(ProviderError, 'invalid visual prompt'):
                studio.prepare_prompt(self.root, {'subject': 'forge'}, enhance=True)

    def test_catalog_uses_meta_only_and_no_silent_alias(self):
        self.assertEqual(studio.CATALOG.list()[0]['id'], 'muse-image-1.0')
        with self.assertRaises(ValueError):
            studio.CATALOG.get('muse-image')
        with patch.dict('os.environ', {'MUSE_IMAGE_API_KEY': '', 'MODEL_API_KEY': ''}):
            with self.assertRaises(ProviderError):
                studio.CATALOG.list()
        with patch.dict('os.environ', {'MUSE_IMAGE_API_KEY': ' ', 'MODEL_API_KEY': ' alternate '}):
            self.assertEqual(studio.muse_key(), 'alternate')
        model = studio.CATALOG.list()[0]
        model['id'] = 'changed'
        self.assertEqual(studio.CATALOG.list()[0]['id'], 'muse-image-1.0')

    def test_settings_fail_before_provider_or_manifest(self):
        for change in ({'n': True}, {'n': 2}, {'seed': 1}, {'steps': 10}, {'prompt': ''},
                       {'prompt': 'x' * 4001}, {'aspect_ratio': '16:9'}, {'resolution': '4K'},
                       {'kind': []}, {'title': {}}):
            with self.subTest(change=change), patch.object(studio, 'request_json') as provider:
                with self.assertRaises(ValueError):
                    studio.generate(self.root, settings(**change))
                provider.assert_not_called()
        self.assertFalse((self.root / 'images').exists())

    def test_generation_records_actual_dimensions_and_safe_metadata(self):
        with patch.object(studio, 'request_json', return_value=response()) as provider:
            record = studio.generate(self.root, settings(api_key='never-save', aspect_ratio='3:2', title='Café'))
        url, payload, headers = provider.call_args.args
        self.assertEqual(url, 'https://api.meta.ai/v1/responses')
        self.assertFalse(payload['store'])
        self.assertEqual(payload['tools'], [{'type': 'image_generation', 'size': '1536x1024', 'output_format': 'png'}])
        self.assertEqual(headers['Authorization'], 'Bearer test-image-key')
        self.assertEqual(record['status'], 'completed')
        self.assertEqual(record['images'][0]['width'], 64)
        self.assertEqual(record['images'][0]['height'], 64)
        self.assertEqual(record['usage']['total_tokens'], 50)
        self.assertEqual(studio.image_file(self.root, record['id'], 0).read_bytes(), png())
        saved = studio.record_path(self.root, record['id']).read_text(encoding='utf-8')
        self.assertNotIn('never-save', saved)
        self.assertNotIn('test-image-key', saved)
        self.assertEqual(studio.read_record(self.root, record['id'])['title'], 'Café')

    def test_failure_saves_record_without_retry_or_backup(self):
        for error in (ProviderError('Provider HTTP 429'), TimeoutError('sensitive details')):
            with patch.object(studio, 'request_json', side_effect=error) as provider:
                with self.assertRaises(type(error)):
                    studio.generate(self.root, settings(allow_backup=True))
                self.assertEqual(provider.call_count, 1)
        self.assertTrue(all(item['status'] == 'failed' for item in studio.gallery(self.root)))
        self.assertNotIn('sensitive details', json.dumps(studio.gallery(self.root)))
        self.assertFalse(list((self.root / 'images').glob('*.png')))

    def test_incomplete_malformed_and_corrupt_outputs_fail(self):
        cases = [None, [], {'status': 'queued'}, {'status': 'completed', 'output': [None]},
                 {'status': 'completed', 'output': []}, response(b'not PNG'), response(png()[:-5])]
        bad_crc = bytearray(png())
        bad_crc[29] ^= 1
        cases.append(response(bytes(bad_crc)))
        bad_base64 = response()
        bad_base64['output'][1]['result'] = '!!!'
        cases.append(bad_base64)
        doubled = response()
        doubled['output'].append(doubled['output'][1])
        cases.append(doubled)
        for value in cases:
            with self.subTest(value=type(value)), patch.object(studio, 'request_json', return_value=value):
                with self.assertRaises(ProviderError):
                    studio.generate(self.root, settings())
        self.assertFalse(list((self.root / 'images').glob('*.png')))
        self.assertTrue(all(item['status'] == 'failed' for item in studio.gallery(self.root)))

    def test_gallery_and_image_paths_ignore_manifest_paths(self):
        with patch.object(studio, 'request_json', return_value=response()):
            record = studio.generate(self.root, settings())
        ident = record['id']
        record['images'][0]['file'] = '../private.txt'
        studio.save(studio.record_path(self.root, ident), record)
        self.assertEqual(studio.image_file(self.root, ident, 0).name, ident + '-0.png')
        for invalid in ('../private', 'x' * 24, 'a' * 23):
            with self.assertRaises(ValueError):
                studio.read_record(self.root, invalid)
        for index in (-1, 1, True):
            with self.assertRaises(ValueError):
                studio.image_file(self.root, ident, index)
        (self.root / 'images' / ('b' * 24 + '.json')).write_text('[]')
        self.assertEqual(len(studio.gallery(self.root)), 1)

    def test_cli_prepare_generate_and_gallery(self):
        brief = self.root / 'brief.json'
        prepared = self.root / 'prepared.json'
        brief.write_text(json.dumps({'subject': 'Aster'}))
        base = ['paramyth-images', '--folder', str(self.root)]
        with patch('sys.argv', base + ['prepare', '--request', str(brief), '--out', str(prepared)]), redirect_stdout(io.StringIO()):
            studio.main()
        self.assertEqual(json.loads(prepared.read_text())['model'], 'muse-image-1.0')
        with patch('sys.argv', base + ['generate', '--request', str(prepared)]), \
             patch.object(studio, 'request_json', return_value=response()), redirect_stdout(io.StringIO()):
            studio.main()
        output = io.StringIO()
        with patch('sys.argv', base + ['gallery']), redirect_stdout(output):
            studio.main()
        self.assertEqual(json.loads(output.getvalue())['images'][0]['status'], 'completed')

    def test_art_direction_genre_storyboard_and_explicit_finish(self):
        for text, expected in [('Ancient Troy, bronze tools', 'Period film still'),
                               ('An orbital spacecraft', 'Grounded science fiction'),
                               ('A detective investigates murder', 'Noir photography'),
                               ('A whimsical bedtime fairy tale', 'Gouache storybook')]:
            with self.subTest(text=text):
                self.assertEqual(art_direction({'kind': 'scene'}, [{'text': text}])['style'], expected)
        self.assertEqual(art_direction({'kind': 'storyboard'}, [])['style'], 'Pencil storyboard')
        result = art_direction({'kind': 'scene', 'style': 'Oil painting', 'natural_finish': False}, [])
        self.assertFalse(result['automatic'])
        self.assertNotIn('skin texture', result['guidance'])


class ProviderTests(unittest.TestCase):
    def test_bounded_json_and_no_secret_in_errors(self):
        for body in (b'[]', b'not JSON', b'x' * 11):
            with patch('paramyth.providers.build_opener') as opener:
                opener.return_value.open.return_value.__enter__.return_value.read.return_value = body
                with self.assertRaises(ProviderError):
                    request_json('https://example.invalid', {}, max_bytes=10)
                self.assertEqual(opener.return_value.open.call_count, 1)
        for error in (HTTPError('https://example.invalid?key=secret', 401, 'secret', {}, None), URLError('secret')):
            with patch('paramyth.providers.build_opener') as opener:
                opener.return_value.open.side_effect = error
                with self.assertRaises(ProviderError) as caught:
                    request_json('https://example.invalid', {})
                self.assertNotIn('secret', str(caught.exception))
                self.assertEqual(opener.return_value.open.call_count, 1)

    def test_transport_accepts_json_and_disallows_unsafe_urls(self):
        with patch('paramyth.providers.build_opener') as opener:
            opener.return_value.open.return_value.__enter__.return_value.read.return_value = b'{"status":"completed"}'
            self.assertEqual(request_json('https://example.invalid', {'prompt': 'hello'})['status'], 'completed')
            request = opener.return_value.open.call_args.args[0]
            self.assertEqual(json.loads(request.data), {'prompt': 'hello'})
        for url in ('http://example.invalid', 'https://user:secret@example.invalid', 'file:///tmp/secret'):
            with self.assertRaises(ValueError):
                request_json(url)


if __name__ == '__main__':
    unittest.main()
