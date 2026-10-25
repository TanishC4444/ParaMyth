import os
import unittest
from unittest.mock import patch

from paramyth.calendar_sync import GoogleCalendar
from paramyth.production import normalize_config, schedule
from paramyth.providers import ProviderError


def scene(ident='s1', **overrides):
    return {'id': ident, 'title': 'Scene ' + ident, 'location': 'shore', 'description': 'Film action', 'cast': ['Meles'],
            'minutes': 60, 'light': 'day', 'dependencies': [], **overrides}


class CalendarSyncTests(unittest.TestCase):
    def setUp(self):
        cfg = normalize_config({'start_date': '2026-11-02', 'timezone': 'America/Chicago'})
        self.plan = {'id': 'a' * 24, 'title': 'Troy', 'created_at': '2026-10-24T12:00:00+00:00', 'config': cfg, 'schedule': schedule([scene()], cfg)}

    def test_sync_is_private_idempotent_and_stops_on_conflicts(self):
        client = GoogleCalendar()
        with patch.object(client, 'request', side_effect=[{'items': []}, {'id': 'created'}]) as call:
            self.assertEqual(len(client.sync(self.plan)['created']), 1)
        payload = call.call_args.args[1]
        self.assertNotIn('attendees', payload)
        self.assertEqual((payload['visibility'], payload['status']), ('private', 'tentative'))
        self.assertEqual(payload['extendedProperties']['private']['paramyth_plan'], 'a' * 24)
        with patch.object(client, 'request', return_value={'items': [{'id': payload['id']}]}) as call:
            self.assertEqual(client.sync(self.plan)['existing'], ['s1'])
        self.assertEqual(call.call_count, 1)
        event = self.plan['schedule']['events'][0]
        busy = {'items': [{'id': 'other', 'start': {'dateTime': event['start']}, 'end': {'dateTime': event['end']}}]}
        with patch.object(client, 'request', return_value=busy) as call:
            self.assertEqual(len(client.sync(self.plan)['conflicts']), 1)
        self.assertEqual(call.call_count, 1)

    def test_partial_sync_keeps_created_ids_and_unscheduled_plans_are_refused(self):
        self.plan['schedule'] = schedule([scene('a'), scene('b', dependencies=['a'])], self.plan['config'])
        client = GoogleCalendar()
        with patch.object(client, 'request', side_effect=[{'items': []}, {'id': 'first'}, ProviderError('Provider HTTP 503')]):
            result = client.sync(self.plan)
        self.assertEqual((result['created'][0]['event_id'], result['stopped_at']), ('first', 'b'))
        self.assertIn('503', result['error'])
        self.plan['schedule']['unscheduled'] = ['c']
        with patch.object(client, 'request') as call, self.assertRaisesRegex(ValueError, 'unscheduled'):
            client.sync(self.plan)
        call.assert_not_called()

    def test_no_token_means_no_request(self):
        with patch.dict(os.environ, {'GOOGLE_CALENDAR_ACCESS_TOKEN': '', 'GOOGLE_CALENDAR_REFRESH_TOKEN': ''}):
            client = GoogleCalendar()
            with patch('paramyth.calendar_sync.request_json') as call, self.assertRaisesRegex(ProviderError, 'Connect Google Calendar'):
                client.request('calendars/primary/events')
        call.assert_not_called()


if __name__ == '__main__':
    unittest.main()
