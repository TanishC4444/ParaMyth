import csv
import io
import json
import unittest

from paramyth.production import normalize_config, schedule
from paramyth.production_exports import EXPORTS, calendar_ics, csv_bytes, export


def scene(ident='s1', **overrides):
    return {'id': ident, 'title': 'Scene ' + ident, 'location': 'shore', 'description': 'Film action', 'cast': ['Meles'],
            'minutes': 60, 'light': 'day', 'dependencies': [], **overrides}


class ExportTests(unittest.TestCase):
    def setUp(self):
        cfg = normalize_config({'start_date': '2026-11-02', 'timezone': 'America/Chicago'})
        self.plan = {'id': 'a' * 24, 'title': 'Troy', 'created_at': '2026-10-24T12:00:00+00:00', 'config': cfg,
                     'schedule': schedule([scene()], cfg), 'recommendations': {'legal_logistics': [{'task': 'Check permit', 'owner': 'producer', 'source_ids': ['R1']}]},
                     'budget': {'items': [{'category': 'crew', 'description': '=cmd|calc', 'quantity': 1, 'unit': 'day', 'low_rate': 1, 'high_rate': 2}]}}

    def test_ics_escapes_folds_by_octet_and_stays_tentative(self):
        self.plan['schedule']['events'][0]['summary'] = 'Troy, shore; ' + '海' * 60 + '\nEND:VEVENT'
        ics = calendar_ics(self.plan)
        self.assertTrue(all(len(line) <= 75 for line in ics.split(b'\r\n')))
        ics.decode('utf-8')
        self.assertIn(b'STATUS:TENTATIVE', ics)
        self.assertIn(b'\\nEND:VEVENT', ics)
        self.assertEqual(ics.count(b'BEGIN:VEVENT'), 1)
        self.assertIn(b'PRODID:-//ParaMyth//Production//EN', ics)

    def test_csv_neutralizes_formulas_and_serializes_lists(self):
        output = csv_bytes([{'task': '=HYPERLINK("bad")', 'cast': ['A', 'B']}], ['task', 'cast']).decode('utf-8-sig')
        row = next(csv.DictReader(io.StringIO(output)))
        self.assertEqual(row['task'], '\'=HYPERLINK("bad")')
        self.assertEqual(json.loads(row['cast']), ['A', 'B'])

    def test_every_export_kind_renders(self):
        for kind in EXPORTS:
            with self.subTest(kind=kind):
                data, mime = export(self.plan, kind)
                self.assertTrue(data)
                self.assertTrue(mime)
        self.assertIn("'=cmd|calc", export(self.plan, 'budget.csv')[0].decode('utf-8-sig'))
        self.assertIn(b'TO CONFIRM', export(self.plan, 'call-sheets.txt')[0])
        with self.assertRaises(ValueError):
            export(self.plan, '../secrets')


if __name__ == '__main__':
    unittest.main()
