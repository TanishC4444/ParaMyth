import unittest
from scripts.copy_lint import ROOT, check, extract, lint, scan_script


def ids(text):
    return {rid for rid, _, _, _ in check(text)}


class CopyLintTests(unittest.TestCase):
    def test_flags_humanizer_patterns_in_copy(self):
        self.assertIn('em-dash', ids('Advisory only — never commits canon.'))
        self.assertIn('importance-formula', ids("It's important to note that runs are cached."))
        self.assertIn('hedge-stack', ids('This may take a while and might fail.'))
        self.assertIn('ai-vocab', ids('A robust way to delve into your story.'))
        self.assertIn('hype', ids('Seamlessly sync your manuscript.'))
        self.assertIn('chatbot', ids('Oops, something broke.'))
        self.assertIn('click-here', ids('Click here to connect.'))
        self.assertIn('jargon', ids('Acceptance binds to the current prose hash.'))
        self.assertIn('stiff', ids('Submit'))

    def test_house_voice_passes(self):
        for text in ['Project saved.', 'Fix 2 blocking findings first.', "Pausing playback won't stop a paid generation.",
                     'Start run', '$1,800 – $2,600', '—']:
            self.assertEqual(check(text), [], text)

    def test_identifiers_and_silenced_story_text_are_skipped(self):
        path = ROOT / 'frontend-pipeline/src/views/Creative.tsx'
        texts = [t for _, t in extract(path)]
        self.assertNotIn('review-item', texts)
        self.assertFalse(any('The first thing anyone noticed was the quiet' in t for t in texts))
        self.assertIn('Revise this', texts)

    def test_jsx_text_and_templates_are_read_whole(self):
        texts = [t for _, t in scan_script('<PageTitle text={`Every workflow run across your projects. ${WORKERS} workers`} />\n<h2>Events</h2>')]
        self.assertTrue(any(t.startswith('Every workflow run across your projects. {x} workers') for t in texts))
        self.assertIn('Events', texts)

    def test_site_copy_has_no_errors(self):
        errors = [h for h in lint() if h[3] == 'error']
        self.assertEqual(errors, [], 'Run: python -m scripts.copy_lint (see .claude/skills/site-copy/SKILL.md)')


if __name__ == '__main__':
    unittest.main()
