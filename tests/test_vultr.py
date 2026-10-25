import io
import json
import os
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from paramyth import vultr
from paramyth.providers import ProviderError

KEY = {'VULTR_INFERENCE_API_KEY': 'test-key'}


def wire(values):
    return io.BytesIO(''.join('data: ' + json.dumps(v) + '\n\n' for v in values).encode())


class Opener:
    def __init__(self, body=None, error=None):
        self.body, self.error, self.requests = body, error, []

    def open(self, request, timeout):
        self.requests.append(request)
        if self.error:
            raise self.error
        return self.body


class VultrTests(unittest.TestCase):
    def test_missing_key_stops_before_any_request(self):
        with patch.dict(os.environ, {'VULTR_INFERENCE_API_KEY': ''}), patch('paramyth.vultr.request_json') as call:
            with self.assertRaisesRegex(ProviderError, 'VULTR_INFERENCE_API_KEY'):
                vultr.chat([{'role': 'user', 'content': 'x'}])
        call.assert_not_called()

    def test_chat_returns_object_and_usage(self):
        reply = {'choices': [{'message': {'content': '{"title":"A"}'}, 'finish_reason': 'stop'}], 'usage': {'total_tokens': 3}}
        with patch.dict(os.environ, KEY), patch('paramyth.vultr.request_json', return_value=reply) as call:
            self.assertEqual(vultr.chat([{'role': 'user', 'content': 'x'}]), ({'title': 'A'}, {'total_tokens': 3}))
        url, payload = call.call_args.args
        self.assertEqual(url, 'https://api.vultrinference.com/v1/chat/completions')
        self.assertEqual(payload['model'], 'muse-glimmer-30b')
        self.assertEqual(payload['response_format'], {'type': 'json_object'})
        self.assertEqual(call.call_args.kwargs['headers']['Authorization'], 'Bearer test-key')

    def test_truncated_or_non_object_output_is_rejected(self):
        for reply in ({'choices': [{'message': {'content': '{"a":1}'}, 'finish_reason': 'length'}]},
                      {'choices': [{'message': {'content': '[1]'}, 'finish_reason': 'stop'}]},
                      {'choices': []}):
            with self.subTest(reply=reply), self.assertRaisesRegex(ProviderError, 'incomplete'):
                vultr.parse(reply)

    def test_stream_collects_deltas_and_usage(self):
        opener, seen = Opener(wire([{'choices': [{'delta': {'content': '{"text":"Hi'}}]},
                                    {'choices': [{'delta': {'content': '"}'}, 'finish_reason': 'stop'}]},
                                    {'choices': [], 'usage': {'total_tokens': 4}}])), []
        with patch.dict(os.environ, KEY), patch('paramyth.vultr.build_opener', return_value=opener):
            result = vultr.stream_chat([{'role': 'user', 'content': 'x'}], seen.append)
        self.assertEqual(seen, ['{"text":"Hi', '{"text":"Hi"}'])
        self.assertEqual(result['usage'], {'total_tokens': 4})
        sent = json.loads(opener.requests[0].data)
        self.assertTrue(sent['stream'])
        self.assertEqual(opener.requests[0].get_header('Accept'), 'text/event-stream')

    def test_unfinished_stream_and_http_errors_are_not_results(self):
        cases = [(Opener(wire([{'choices': [{'delta': {'content': '{"text":"Un'}, 'finish_reason': 'length'}]}])), 'before completion'),
                 (Opener(wire([{'error': {'message': 'secret detail'}}])), 'stopped the stream'),
                 (Opener(error=HTTPError('https://x', 401, 'no', {}, io.BytesIO())), 'HTTP 401')]
        for opener, message in cases:
            with self.subTest(message=message), patch.dict(os.environ, KEY), patch('paramyth.vultr.build_opener', return_value=opener):
                with self.assertRaisesRegex(ProviderError, message) as caught:
                    vultr.stream_chat([{'role': 'user', 'content': 'x'}], lambda raw: None)
                self.assertNotIn('secret', str(caught.exception))

    def test_partial_json_never_exposes_escapes_or_nested_text(self):
        raw = json.dumps({'title': 'A title', 'text': 'A "quote"\nAnd a dragon 🐉.', 'summary': 'Done'})
        for end in range(len(raw) + 1):
            for name, value in vultr.preview(raw[:end]).items():
                self.assertTrue(json.loads(raw)[name].startswith(value), (end, name))
        self.assertEqual(vultr.preview(raw), json.loads(raw))
        self.assertEqual(vultr.preview('{"nested":{"text":"secret"},"text":"hello'), {'text': 'hello'})
        self.assertEqual(vultr.preview('{"text":"a\\uD83D'), {'text': 'a'})


if __name__ == '__main__':
    unittest.main()
