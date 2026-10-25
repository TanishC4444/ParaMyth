import io
import json
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError, URLError
from paramyth.live import ChatTransport, ProviderError
from paramyth.contracts import ContractError, assessed_review
from paramyth.coordinator import run
from paramyth.fixture import respond


class Opener:
    def __init__(self, outputs):
        self.outputs, self.calls = list(outputs), []
    def open(self, request, timeout):
        self.calls.append((request, timeout))
        value = self.outputs.pop(0)
        if isinstance(value, Exception):
            raise value
        return io.BytesIO(json.dumps(value).encode())


def response(reason='stop'):
    return {'choices': [{'message': {'content': 'prose'}, 'finish_reason': reason}],
            'usage': {'total_tokens': 12}, 'model': 'test-model'}


def error(code):
    return HTTPError('https://provider.example/v1', code, 'test', {}, None)


class LiveTests(unittest.TestCase):
    def transport(self, outputs, **kw):
        return ChatTransport('https://provider.example/v1', 'test-model', 'secret-test-key',
                             opener=Opener(outputs), sleep=lambda _: None, **kw)

    def test_response_and_explicit_limits(self):
        transport = self.transport([response()])
        result = transport('writer', {'scene': {}}, {})
        self.assertEqual(result['finish_reason'], 'stop')
        self.assertEqual(result['usage']['total_tokens'], 12)
        request, timeout = transport.opener.calls[0]
        self.assertEqual(timeout, 60)
        self.assertEqual(json.loads(request.data)['max_completion_tokens'], 2048)
        self.assertNotIn('secret-test-key', json.dumps(transport.events))

    def test_transient_retry_is_bounded(self):
        transport = self.transport([error(503), response()])
        self.assertEqual(transport('writer', {}, {})['text'], 'prose')
        self.assertEqual(len(transport.events), 2)
        exhausted = self.transport([error(500)] * 3)
        with self.assertRaises(ProviderError):
            exhausted('writer', {}, {})
        self.assertEqual(len(exhausted.events), 3)

    def test_auth_quota_and_config_do_not_retry(self):
        for code in [400, 401, 403, 429]:
            with self.subTest(code=code):
                transport = self.transport([error(code)])
                with self.assertRaises(ProviderError):
                    transport('writer', {}, {})
                self.assertEqual(len(transport.events), 1)
                if code in [401, 403, 429]:
                    with self.assertRaisesRegex(ProviderError, 'cooldown'):
                        transport('writer', {}, {})
                    self.assertEqual(len(transport.events), 1)

    def test_timeout_does_not_duplicate_generation(self):
        transport = self.transport([URLError('timeout')])
        with self.assertRaisesRegex(ProviderError, 'usage unknown'):
            transport('writer', {}, {})
        self.assertEqual(len(transport.events), 1)
        self.assertIsNone(transport.events[0]['usage'])

    def test_malformed_and_truncated_metadata(self):
        with self.assertRaises(ContractError):
            self.transport([{}])('writer', {}, {})
        self.assertEqual(self.transport([response('length')])('writer', {}, {})['finish_reason'], 'length')
        for url in ['http://provider.example', 'https://user:pass@provider.example', 'https://provider.example/?key=x']:
            with self.assertRaises(ValueError):
                ChatTransport(url, 'model', 'key')

    def test_reviews_require_source_bound_assessments(self):
        with self.assertRaises(ContractError):
            assessed_review({'pass': True, 'issues': []}, 'Actual prose.', ['continuity'])
        with self.assertRaises(ContractError):
            assessed_review({'pass': True, 'issues': [], 'checks': [
                {'category': 'continuity', 'reason': 'ok', 'quote': 'Invented prose.'}]}, 'Actual prose.', ['continuity'])

    def test_actor_isolation_and_role_order(self):
        req = json.loads(Path('example.json').read_text())
        calls, actors = [], []
        def record(role, packet, value):
            calls.append(role)
            if role == 'character':
                actors.append(packet)
            return respond(role, packet, value)
        with tempfile.TemporaryDirectory() as d:
            state = run(req, d, approve_plan=True, stop_after=1, transport=record)
        self.assertEqual(len(state['accepted']), 1)
        self.assertLess(calls.index('character'), calls.index('director'))
        self.assertLess(calls.index('director'), calls.index('writer'))
        by_actor = {packet['character']['id']: packet for packet in actors}
        for packet in by_actor.values():
            self.assertNotIn('scene', packet)
            self.assertNotIn('characters', packet)
        self.assertEqual(by_actor['mara']['visible_memory'], [])
        self.assertEqual(len(by_actor['oren']['visible_memory']), 1)
        self.assertEqual(by_actor['oren']['visible_memory'][0]['known_by'], ['oren'])

    def test_provider_identity_is_pinned_on_resume(self):
        class Transport:
            identity = {'model': 'one'}
            def __call__(self, *args):
                return respond(*args)
        transport = Transport()
        req = json.loads(Path('example.json').read_text())
        with tempfile.TemporaryDirectory() as d:
            run(req, d, backend='custom', transport=transport)
            transport.identity = {'model': 'two'}
            with self.assertRaisesRegex(ContractError, 'Provider settings changed'):
                run(req, d, backend='custom', transport=transport)


if __name__ == '__main__':
    unittest.main()
