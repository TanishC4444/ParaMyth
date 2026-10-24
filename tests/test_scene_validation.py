import json
from pathlib import Path
import tempfile
import unittest
from paramyth.contracts import ContractError, request, plan
from paramyth.coordinator import run
from paramyth.executor import Executor
from paramyth.fixture import respond
from paramyth.storage import load


def req():
    return request(json.loads(Path('example.json').read_text()))


class SceneValidationTests(unittest.TestCase):
    def test_scene_grid(self):
        for chapters, scenes in [(1, 1), (1, 4), (2, 2), (3, 3), (4, 2)]:
            with self.subTest(chapters=chapters, scenes=scenes), tempfile.TemporaryDirectory() as d:
                value = req()
                value.update(chapters=chapters, scenes_per_chapter=scenes)
                first = run(value, d, approve_plan=True, stop_after=1)
                final = run(value, d)
                self.assertTrue(final['complete'])
                self.assertEqual(len(final['accepted']), chapters * scenes)
                self.assertEqual(final['accepted'][:1], first['accepted'])

    def test_truncation_preserves_prefix(self):
        with tempfile.TemporaryDirectory() as d:
            original = run(req(), d, approve_plan=True, stop_after=1)
            def truncated(role, packet, value):
                return {'text': respond(role, packet, value), 'finish_reason': 'length',
                        'usage': {'output_tokens': 17}}
            with self.assertRaisesRegex(ContractError, 'Incomplete role response'):
                run(req(), d, transport=truncated)
            self.assertEqual(load(Path(d) / 'state.json'), original)
            reports = [load(p) for p in (Path(d) / 'attempts').glob('*.json')]
            failures = [r for r in reports if r['status'] == 'error']
            self.assertEqual(len(failures), 2)
            self.assertTrue(all(r['usage']['output_tokens'] == 17 for r in failures))
            self.assertTrue(run(req(), d)['complete'])

    def test_truncation_retry(self):
        calls = []
        def transport(*args):
            calls.append(1)
            return {'text': 'draft', 'finish_reason': 'length' if len(calls) == 1 else 'stop'}
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(Executor(req(), d, transport).call('writer', {}), 'draft')
            cached = list((Path(d) / 'calls').glob('*.json'))
            self.assertEqual(len(cached), 1)
            self.assertEqual(load(cached[0])['output']['finish_reason'], 'stop')

    def test_transport_error_diagnostics(self):
        def unavailable(*args):
            raise RuntimeError('provider unavailable')
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(RuntimeError):
                Executor(req(), d, unavailable).call('writer', {})
            reports = list((Path(d) / 'attempts').glob('*.json'))
            self.assertEqual(len(reports), 1)
            report = load(reports[0])
            self.assertEqual(report['error_type'], 'RuntimeError')
            self.assertIsNone(report['usage'])
            self.assertGreaterEqual(report['elapsed_seconds'], 0)

    def test_metadata_assignment(self):
        value = req()
        generated = json.loads(respond('architect', {}, value))
        for scene in generated['scenes']:
            scene.pop('id')
            scene['chapter'] = 99
        result = plan(generated, value)
        self.assertEqual(result['scenes'][0]['id'], 'ch01-sc01')
        self.assertEqual(result['scenes'][-1]['chapter'], value['chapters'])
        self.assertEqual(generated['scenes'][0]['chapter'], 99)

    def test_invalid_plans_preserve_canon(self):
        for mode in ['duplicate', 'reordered', 'missing']:
            def invalid(role, packet, value):
                output = respond(role, packet, value)
                if role == 'architect':
                    generated = json.loads(output)
                    if mode == 'duplicate':
                        generated['scenes'][1]['id'] = generated['scenes'][0]['id']
                    elif mode == 'reordered':
                        generated['scenes'][0], generated['scenes'][1] = generated['scenes'][1], generated['scenes'][0]
                    else:
                        generated['scenes'].pop()
                    return json.dumps(generated)
                return output
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as d:
                with self.assertRaises(ContractError):
                    run(req(), d, approve_plan=True, transport=invalid)
                state = load(Path(d) / 'state.json')
                self.assertEqual(state['accepted'], [])
                self.assertNotIn('plan', state)


if __name__ == '__main__':
    unittest.main()
