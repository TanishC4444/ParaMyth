"""Output library: allowed file types only, no hidden files, symlinks or path escapes."""
import os
import unittest

from test_studio_projects import StudioTestCase


class LibraryTests(StudioTestCase):
    def test_lists_and_serves_project_outputs_only(self):
        ident = self.project()
        root = self.runtime.folder(ident)
        (root / 'creative').mkdir()
        (root / 'creative' / 'draft.txt').write_text('A draft')
        (root / 'page.html').write_text('<script>alert(1)</script>')
        (root / '.env').write_text('SECRET=x')
        (root / 'node_modules').mkdir()
        (root / 'node_modules' / 'x.json').write_text('{}')
        (self.root / 'outside.txt').write_text('outside')
        os.symlink(self.root / 'outside.txt', root / 'link.txt')
        query = {'project_id': ident}
        files = {f['path'] for f in self.client.get('/api/studio/outputs', params=query).json()['files']}
        self.assertEqual(files, {'story.txt', 'creative/draft.txt'})
        opened = self.client.get('/api/studio/output', params={**query, 'path': 'creative/draft.txt'})
        self.assertEqual((opened.text, opened.headers['x-content-type-options']), ('A draft', 'nosniff'))
        saved = self.client.get('/api/studio/output', params={**query, 'path': 'story.txt', 'download': 'true'})
        self.assertIn('attachment', saved.headers['content-disposition'])
        for path in ('page.html', '.env', 'link.txt', '../outside.txt', 'node_modules/x.json'):
            with self.subTest(path=path):
                self.assertEqual(self.client.get('/api/studio/output', params={**query, 'path': path}).status_code, 422)


if __name__ == '__main__':
    unittest.main()
