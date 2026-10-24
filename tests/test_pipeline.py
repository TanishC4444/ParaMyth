import copy
import json
from pathlib import Path
import tempfile
import unittest
from paramyth.contracts import ContractError
from paramyth.coordinator import run, visible
from paramyth.fixture import respond
from paramyth.storage import load


def example():
    return json.loads(Path('example.json').read_text())


class PipelineTests(unittest.TestCase):
    def test_approval_stop_resume_and_idempotency(self):
        with tempfile.TemporaryDirectory() as d:
            state = run(example(), d)
            self.assertFalse(state['plan_approved'])
            self.assertEqual(state['accepted'], [])
            state = run(example(), d, approve_plan=True, stop_after=2)
            original = copy.deepcopy(state['accepted'])
            self.assertEqual(len(original), 2)
            state = run(example(), d)
            self.assertTrue(state['complete'])
            self.assertEqual(state['accepted'][:2], original)
            self.assertEqual(len(state['accepted']), 9)
            self.assertEqual(len(list((Path(d) / 'chapters').glob('*.txt'))), 3)
            self.assertIn('FIXTURE', (Path(d) / 'story.txt').read_text())
            calls = len(list((Path(d) / 'calls').glob('*.json')))
            self.assertEqual(run(example(), d), state)
            self.assertEqual(len(list((Path(d) / 'calls').glob('*.json'))), calls)

    def test_changed_request_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            run(example(), d)
            changed = example()
            changed['premise'] = 'A different premise'
            with self.assertRaises(ContractError):
                run(changed, d)
            with self.assertRaises(ContractError):
                run(example(), d, backend='custom', transport=respond)

    def test_rejected_review_preserves_canon(self):
        def reject(role, packet, req):
            if role == 'story_quality':
                return json.dumps({'pass': False, 'issues': []})
            return respond(role, packet, req)
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ContractError):
                run(example(), d, approve_plan=True, transport=reject)
            state = load(Path(d) / 'state.json')
            self.assertEqual(state['accepted'], [])
            self.assertEqual(state['version'], 0)
            self.assertTrue(list((Path(d) / 'work').glob('*/draft.txt')))

    def test_unsupported_memory_preserves_canon(self):
        def invalid(role, packet, req):
            if role == 'memory':
                return json.dumps({'memories': [{'kind': 'event', 'text': 'Unsupported event',
                    'evidence': 'This sentence never appeared in the prose.', 'known_by': ['mara']}]})
            return respond(role, packet, req)
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ContractError):
                run(example(), d, approve_plan=True, transport=invalid)
            self.assertEqual(load(Path(d) / 'state.json')['accepted'], [])

    def test_writer_receives_only_pov_visible_memory(self):
        packets = []
        def record(role, packet, req):
            if role == 'writer':
                packets.append(packet)
            return respond(role, packet, req)
        with tempfile.TemporaryDirectory() as d:
            run(example(), d, approve_plan=True, stop_after=1, transport=record)
        self.assertEqual(packets[0]['pov_visible_memory'], [])
        facts = example()['initial_facts']
        self.assertEqual(visible(facts, 'mara'), [])
        self.assertEqual(len(visible(facts, 'oren')), 1)

    def test_invalid_json_retries_are_bounded(self):
        calls = []
        def invalid(role, packet, req):
            calls.append(role)
            return 'not json'
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ContractError):
                run(example(), d, transport=invalid)
        self.assertEqual(len(calls), 2)

    def test_retrieval_is_injected_once(self):
        calls = []
        def retrieve(req):
            calls.append(req['project_id'])
            return {'sources': []}
        with tempfile.TemporaryDirectory() as d:
            run(example(), d, retrieval=retrieve)
            run(example(), d, retrieval=retrieve)
        self.assertEqual(calls, ['harbor'])


if __name__ == '__main__':
    unittest.main()
