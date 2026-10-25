import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from paramyth import canon
from paramyth.contracts import ContractError
from paramyth.retrieval import build_index, retrieve


class CanonTests(unittest.TestCase):
    def test_visibility_precedes_current_projection(self):
        old = canon.initialize([{'text': 'Three charges remain.', 'kind': 'resource', 'amount': 3,
                                'fact_key': 'charges', 'known_by': ['mara', 'oren']}])
        scene = {'id': 'ch01-sc01', 'participants': ['mara']}
        new = canon.append(old, [{'text': 'Two charges remain.', 'kind': 'resource', 'amount': 2,
               'change': -1, 'fact_key': 'charges', 'known_by': ['mara'], 'evidence': 'Two charges remain.',
               'supersedes': [old[0]['id']]}], 'Two charges remain.', scene, ['mara', 'oren'])
        self.assertEqual(canon.current(new, 'mara')[0]['amount'], 2)
        self.assertEqual(canon.current(new, 'oren')[0]['amount'], 3)
        self.assertEqual(len(new), 2)
        self.assertEqual(len(old), 1)

    def test_invalid_update_never_mutates_history(self):
        original = canon.initialize([{'text': 'Three charges remain.', 'kind': 'resource', 'amount': 3,
                                     'fact_key': 'charges', 'known_by': ['mara']}])
        for field, value in [('amount', 8), ('supersedes', ['future']), ('known_by', ['public']), ('known_by', ['oren'])]:
            fact = {'kind': 'resource', 'text': 'Two charges remain.', 'amount': 2, 'change': -1,
                    'fact_key': 'charges', 'known_by': ['mara'], 'evidence': 'Two charges remain.',
                    'supersedes': [original[0]['id']]}
            fact[field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ContractError):
                canon.append(original, [fact], 'Two charges remain.', {'id': 's1', 'participants': ['mara']}, ['mara', 'oren'])
            self.assertEqual(len(original), 1)

    def test_selection_keeps_old_resources_and_reports_omissions(self):
        history = canon.initialize([{'kind': 'resource', 'amount': 2, 'text': 'Two charges.', 'known_by': ['mara']}] +
                                   [{'text': 'Routine event ' + str(i), 'known_by': ['mara']} for i in range(20)])
        selection = canon.select(history, 'mara', budget=400)
        self.assertEqual(selection['facts'][0]['kind'], 'resource')
        self.assertTrue(selection['omitted_ids'])
        self.assertEqual(len(history), 21)

    def test_retrieval_versions_hash_and_source_ids(self):
        sources = [{'id': 'bell', 'title': 'Bell mechanism', 'text': 'Bell latch repair requires cooperation.'},
                   {'id': 'sea', 'title': 'Ocean', 'text': 'Waves and tides.'}]
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'index.db'
            digest = build_index(path, sources)
            result = retrieve(path, 'bell latch', expected_hash=digest)
            self.assertEqual(result['sources'][0]['id'], 'bell')
            self.assertEqual(result['corpus_hash'], digest)
            with self.assertRaises(ContractError):
                retrieve(path, 'bell', expected_hash='stale')
            with sqlite3.connect(path) as db:
                db.execute("UPDATE metadata SET value='old' WHERE key='version'")
            with self.assertRaises(ContractError):
                retrieve(path, 'bell')
            # Reads close their connection; rebuilding and deleting remain possible.
            build_index(path, sources)
            path.unlink()


if __name__ == '__main__':
    unittest.main()
