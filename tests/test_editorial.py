import json
from pathlib import Path
import tempfile
import threading
import unittest
from paramyth.coordinator import run
from paramyth.contracts import ContractError
from paramyth.fixture import respond
from paramyth.storage import load


def request():
    value = json.loads(Path('example.json').read_text())
    value.update(chapters=1, scenes_per_chapter=1)
    return value


def rejected(prose):
    return json.dumps({'pass': False, 'issues': [{'severity': 'blocking', 'category': 'continuity',
        'quote': prose[:28], 'problem': 'A consequence is missing.', 'fix': 'Show a concrete consequence.'}],
        'checks': [{'category': c, 'reason': 'A consequence is missing.', 'quote': prose[:28]}
                   for c in ['continuity', 'viewpoint', 'scene_change', 'evidence', 'knowledge']]})


class EditorialTests(unittest.TestCase):
    def test_independent_review_branches_overlap(self):
        barrier = threading.Barrier(3, timeout=5)
        seen = []
        def transport(role, packet, req):
            if role in ('story_quality', 'rhetoric_quality', 'memory'):
                seen.append(threading.get_ident())
                barrier.wait()
            return respond(role, packet, req)
        with tempfile.TemporaryDirectory() as d:
            self.assertTrue(run(request(), d, approve_plan=True, transport=transport)['complete'])
            self.assertEqual(len(set(seen)), 3)
            self.assertTrue((Path(d) / 'FINAL_STORY.txt').exists())

    def test_memory_retry_retains_prose_and_accepted_prefix(self):
        calls = []
        broken = [True]
        def transport(role, packet, req):
            calls.append(role)
            if role == 'memory_quality' and broken[0]:
                return rejected(packet['prose'])
            return respond(role, packet, req)
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(ContractError, 'Memory review blocked'):
                run(request(), d, approve_plan=True, transport=transport)
            self.assertEqual(load(Path(d) / 'state.json')['accepted'], [])
            saved = (Path(d) / 'work/ch01-sc01/draft.txt').read_text()
            broken[0] = False
            calls.clear()
            state = run(request(), d, transport=transport)
            self.assertTrue(state['complete'])
            self.assertNotIn('writer', calls)
            self.assertNotIn('humanizer', calls)
            self.assertNotIn('memory', calls)
            self.assertEqual((Path(d) / 'work/ch01-sc01/draft.txt').read_text(), saved)

    def test_failed_whole_story_audit_never_exports_final(self):
        def transport(role, packet, req):
            if role == 'whole_story_quality':
                return rejected(packet['current_prose'])
            return respond(role, packet, req)
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(ContractError, 'Whole-story audit'):
                run(request(), d, approve_plan=True, transport=transport)
            self.assertTrue((Path(d) / 'PROVISIONAL_STORY.txt').exists())
            self.assertFalse((Path(d) / 'FINAL_STORY.txt').exists())
            self.assertFalse((Path(d) / 'story.txt').exists())
            self.assertEqual(len(load(Path(d) / 'state.json')['accepted']), 1)

    def test_repair_refreshes_memory_and_source_reviews(self):
        extracted = []
        def transport(role, packet, req):
            if role == 'story_quality' and 'The latch stayed open.' not in packet['current_prose']:
                return rejected(packet['current_prose'])
            if role == 'humanizer' and packet.get('repair'):
                return packet['prose'] + '\n\nThe latch stayed open.'
            if role == 'memory':
                extracted.append(packet['prose'])
            return respond(role, packet, req)
        with tempfile.TemporaryDirectory() as d:
            state = run(request(), d, approve_plan=True, transport=transport)
            self.assertTrue(state['complete'])
            self.assertEqual(len(extracted), 2)
            self.assertNotEqual(extracted[0], extracted[1])
            self.assertIn('The latch stayed open.', state['accepted'][0]['prose'])


    def test_chapter_and_final_recovery_keep_completed_work(self):
        for failed_role in ['chapter_quality', 'whole_story_quality']:
            broken, calls = [True], []
            def transport(role, packet, req):
                calls.append(role)
                if role == failed_role and broken[0]:
                    return rejected(packet['current_prose'])
                return respond(role, packet, req)
            with self.subTest(role=failed_role), tempfile.TemporaryDirectory() as d:
                with self.assertRaises(ContractError):
                    run(request(), d, approve_plan=True, transport=transport)
                before = load(Path(d) / 'state.json')['accepted']
                broken[0] = False
                calls.clear()
                final = run(request(), d, transport=transport)
                self.assertTrue(final['complete'])
                self.assertNotIn('writer', calls)
                self.assertNotIn('humanizer', calls)
                self.assertEqual(final['accepted'][:len(before)], before)

    def test_changed_checkpoint_anchor_is_rejected(self):
        def transport(role, packet, req):
            if role == 'memory_quality':
                return rejected(packet['prose'])
            return respond(role, packet, req)
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ContractError):
                run(request(), d, approve_plan=True, transport=transport)
            path = Path(d) / 'state.json'
            state = load(path)
            state['memories'][0]['text'] = 'Altered continuity'
            path.write_text(json.dumps(state))
            with self.assertRaisesRegex(ContractError, 'checkpoint does not match'):
                run(request(), d, transport=transport)


if __name__ == '__main__':
    unittest.main()
