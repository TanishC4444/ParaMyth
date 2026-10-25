"""Author workspace routes: projects, drafts, notes and run requests."""
import json
import unittest

from paramyth.contracts import request as validate_request
from test_studio_projects import StudioTestCase


def author_project(title='Harbor Bell', **brief):
    character = {'id': 'mara', 'name': 'Mara', 'goal': 'Ring the bell', 'fear': 'Storms', 'voice': 'Dry',
                 'arc': {'belief': 'Alone', 'pressure': 'Flood', 'choice': 'Ask Oren', 'change': 'Trusts'}}
    return {'title': title, 'brief': {'premise': 'Mara repairs a harbor bell.', 'medium': 'Novel', 'genre': 'Drama', 'tone': 'Quiet',
                                      'pov': 'Close third', 'themes': ['trust'], 'worldRules': ['Bells warn of storms'], 'mustAvoid': [],
                                      'chapters': 2, 'scenesPerChapter': 2, 'wordMin': 600, 'wordMax': 1000, 'characters': [character], **brief},
            'scenes': [{'id': 's1', 'chapter': 1, 'title': 'Bell', 'pov': 'Mara', 'location': 'Harbor', 'content': 'The bell cracked.',
                        'state': 'Draft', 'findings': [], 'minutes': 1, 'night': False}], 'canon': [], 'versions': []}


class WorkspaceTests(StudioTestCase):
    def test_create_edit_and_conflict_detection(self):
        created = self.post('/api/ui/projects', {'project': author_project()})
        self.assertEqual(created.status_code, 200, created.text)
        p = created.json()
        root = self.runtime.folder(p['id'])
        request = json.loads((root / 'request.json').read_text())
        self.assertEqual((request['title'], request['words_per_scene'], request['characters'][0]['arc']['costly_choice']), ('Harbor Bell', 800, 'Ask Oren'))
        validate_request(dict(request))
        self.assertEqual((root / 'author-draft.txt').read_text(), 'The bell cracked.')
        p['title'] = 'Harbor Bell, revised'
        saved = self.client.put('/api/ui/projects/' + p['id'], json=p, headers={'X-ParaMyth-Token': self.token})
        self.assertEqual(saved.status_code, 200, saved.text)
        stale = self.client.put('/api/ui/projects/' + p['id'], json=p, headers={'X-ParaMyth-Token': self.token})
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(len(list((root / 'author-revisions').glob('*.json'))), 1)
        listed = self.client.get('/api/ui/workspace').json()
        self.assertEqual(listed['projects'][0]['title'], 'Harbor Bell, revised')

    def test_invalid_projects_are_rejected_before_any_file(self):
        for bad in (author_project(medium='Opera'), author_project(wordMin=900, wordMax=100), {**author_project(), 'title': ''}):
            self.assertEqual(self.post('/api/ui/projects', {'project': bad}).status_code, 422)
        self.assertFalse((self.root / 'runs' / 'studio-projects').exists() and any((self.root / 'runs' / 'studio-projects').iterdir()))

    def test_drafts_merge_by_field_and_notes_persist(self):
        ident = self.project()
        patch = lambda body: self.client.patch(f'/api/ui/projects/{ident}/workspace', json=body, headers={'X-ParaMyth-Token': self.token})
        self.assertEqual(patch({'creative.brief': 'A'}).status_code, 200)
        self.assertEqual(patch({'music.direction': 'Rain'}).status_code, 200)
        self.assertEqual(patch({'../escape': 'x'}).status_code, 422)
        self.assertEqual(self.client.get('/api/ui/workspace').json()['drafts'][ident], {'creative.brief': 'A', 'music.direction': 'Rain'})
        pins = [{'projectId': ident, 'recordId': 'odyssey', 'purpose': 'Sea voyage'}]
        self.assertEqual(self.client.put('/api/ui/notes', json={'ideas': ['bell'], 'pins': pins}, headers={'X-ParaMyth-Token': self.token}).status_code, 200)
        self.assertEqual(self.client.get('/api/ui/workspace').json()['pins'], pins)
        request = self.client.get(f'/api/ui/projects/{ident}/request').json()
        self.assertEqual(request['references'], [{'record_id': 'odyssey', 'scope': 'story', 'purpose': 'Sea voyage'}])

    def test_run_folders_open_as_projects_with_current_canon_and_findings(self):
        run = self.root / 'runs' / 'harbor'
        run.mkdir(parents=True)
        (run / 'request.json').write_text(json.dumps({'project_id': 'harbor', 'title': 'The Harbor Bell', 'premise': 'Repair the bell.',
                                                      'characters': [{'id': 'mara', 'name': 'Mara'}], 'chapters': 1, 'scenes_per_chapter': 1}))
        state = {'accepted': [{'id': 's1', 'chapter': 1, 'title': 'Bell', 'prose': 'Mara lifted the bell.',
                               'review': {'issues': [{'severity': 'blocking', 'quote': 'lifted', 'problem': 'Too heavy', 'fix': 'Use a winch'}]}}],
                 'memories': [{'id': 'fact-000001', 'kind': 'event', 'text': 'The bell is cracked.', 'known_by': ['mara'], 'source': 's1', 'supersedes': []},
                              {'id': 'fact-000002', 'kind': 'event', 'text': 'The bell is mended.', 'known_by': ['mara'], 'source': 's1', 'supersedes': ['fact-000001']}]}
        (run / 'state.json').write_text(json.dumps(state))
        fixture = self.root / 'runs' / 'fixture'
        fixture.mkdir()
        (fixture / 'state.json').write_text(json.dumps({'backend': 'fixture'}))
        (fixture / 'request.json').write_text(json.dumps({'title': 'Fixture'}))
        projects = self.client.get('/api/ui/workspace').json()['projects']
        self.assertEqual([p['title'] for p in projects], ['The Harbor Bell'])
        p = projects[0]
        self.assertEqual(p['scenes'][0]['findings'][0]['severity'], 'Blocking')
        self.assertEqual([f['text'] for f in p['canon']], ['The bell is mended.'])
        self.assertEqual((p['brief']['wordMin'], p['brief']['wordMax']), (638, 1105))


if __name__ == '__main__':
    unittest.main()
