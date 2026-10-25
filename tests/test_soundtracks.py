import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import wave

from paramyth import soundtracks
from paramyth.providers import ProviderError
from paramyth.story_context import context

KEY = {'VULTR_INFERENCE_API_KEY': 'test-key'}
SPEC = {'id': 'minimax-music3', 'lyrics': 'required', 'duration': {'min': 30, 'max': 360}, 'prompt_max_length': 6000}
JOB = 'music_' + 'a' * 24


class Response(io.BytesIO):
    def __enter__(self):
        return self


class SoundtrackTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        (self.root / 'request.json').write_text(json.dumps({'title': 'Harbor', 'characters': [{'name': 'Mara', 'description': 'afraid of storms'}],
                                                            'world_rules': ['The harbor floods'], 'api_key': 'must-not-leak'}))
        (self.root / 'story.txt').write_text('Wind and rain crossed the ocean. A fire burned.')

    def test_cue_uses_story_characters_and_world_without_secrets(self):
        cue = soundtracks.plan(self.root)
        for text in ('Mara', 'harbor floods', 'crossed the ocean'):
            self.assertIn(text, cue['prompt'])
        self.assertNotIn('must-not-leak', cue['prompt'])
        self.assertEqual(set(cue['layers']), {'wind', 'water', 'fire'})
        (self.root / '.env').write_text('SECRET=do-not-read')
        self.assertNotIn('do-not-read', str(context(self.root)))

    def test_local_soundscape_is_a_valid_reproducible_wav(self):
        ident, cue = soundtracks.ambience(self.root, 'score', seconds=5)
        audio = b''.join(soundtracks.wav_stream(cue, seconds=5))
        self.assertEqual(audio, b''.join(soundtracks.wav_stream(cue, seconds=5)))
        with wave.open(io.BytesIO(audio)) as track:
            self.assertEqual((track.getnframes(), track.getframerate(), track.getnchannels()), (80000, 16000, 1))
        self.assertEqual(len(audio), 160044)
        self.assertTrue(any(audio[10000:20000]))
        saved = json.loads((self.root / 'soundtracks' / (ident + '.json')).read_text())
        self.assertEqual(saved['engine'], 'local-procedural')

    def test_invalid_mode_duration_and_missing_story(self):
        with tempfile.TemporaryDirectory() as empty, self.assertRaises(ValueError):
            soundtracks.plan(empty)
        for call in (lambda: soundtracks.plan(self.root, 'invalid'), lambda: soundtracks.ambience(self.root, seconds=4),
                     lambda: soundtracks.ambience(self.root, 'song'), lambda: next(soundtracks.wav_stream(soundtracks.plan(self.root), 361))):
            with self.assertRaises(ValueError):
                call()

    def test_discover_real_runs_excludes_examples(self):
        self.assertEqual(soundtracks.discover_stories(self.root), [self.root.resolve()])
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            for directory in ('outputs/actual', 'runs/active', 'runs/studio-projects/abc', 'examples/fixture-output'):
                (root / directory).mkdir(parents=True)
                (root / directory / 'FINAL_STORY.txt').write_text('A story')
            self.assertEqual(soundtracks.discover_stories(root), sorted([root / 'outputs/actual', root / 'runs/active', root / 'runs/studio-projects/abc']))

    @patch.dict(os.environ, KEY)
    def test_song_and_instrumental_score_requests(self):
        with patch('paramyth.soundtracks.request_json', side_effect=[{'data': [SPEC]}, {'id': JOB}]) as call:
            job, _ = soundtracks.create(self.root, 'song', SPEC['id'], 30, lyrics='Rain over the harbor')
        self.assertEqual(job['id'], JOB)
        url, body = call.call_args.args
        self.assertEqual((url, body['lyrics'], body['duration']), ('https://api.vultrinference.com/v1/music', 'Rain over the harbor', 30))
        self.assertEqual(call.call_args.kwargs['headers']['Authorization'], 'Bearer test-key')
        self.assertTrue((self.root / 'soundtracks' / (JOB + '.json')).is_file())
        with patch('paramyth.soundtracks.request_json', side_effect=[{'data': [SPEC]}, {'id': JOB}]) as call:
            soundtracks.create(self.root, 'score', SPEC['id'], 60)
        body = call.call_args.args[1]
        self.assertIn('[Instrumental]', body['lyrics'])
        self.assertIn('no singing', body['prompt'])

    @patch.dict(os.environ, KEY)
    def test_invalid_music_requests_start_no_job(self):
        cases = [('song', SPEC['id'], 30, ''), ('song', SPEC['id'], 5, 'words'), ('song', 'unknown', 30, 'words'), ('ambience', SPEC['id'], 30, '')]
        for mode, model, seconds, lyrics in cases:
            with self.subTest(mode=mode, model=model, seconds=seconds), patch('paramyth.soundtracks.request_json', return_value={'data': [SPEC]}) as call:
                with self.assertRaises(ValueError):
                    soundtracks.create(self.root, mode, model, seconds, lyrics=lyrics)
                self.assertTrue(all(c.args[0].endswith('/music/models') for c in call.call_args_list))
        with patch('paramyth.soundtracks.request_json', side_effect=[{'data': [SPEC]}, {'id': 'other'}]), self.assertRaises(ProviderError):
            soundtracks.create(self.root, 'song', SPEC['id'], 30, lyrics='words')

    @patch.dict(os.environ, KEY)
    def test_job_ids_are_checked_before_any_request(self):
        for bad in ('../models', 'music_x', 'music_' + 'A' * 24):
            with self.subTest(bad=bad), patch('paramyth.soundtracks.request_json') as call, self.assertRaises(ValueError):
                soundtracks.status(bad)
            call.assert_not_called()
        with self.assertRaises(ValueError):
            soundtracks.audio(JOB, 'delete')

    @patch.dict(os.environ, KEY)
    def test_download_writes_audio_and_enforces_the_size_limit(self):
        out = self.root / 'track.mp3'
        with patch('paramyth.soundtracks.audio', return_value=Response(b'ID3' + b'\0' * 100)):
            self.assertEqual(soundtracks.download(JOB, out), 103)
        self.assertEqual(out.read_bytes()[:3], b'ID3')
        with patch('paramyth.soundtracks.MAX_AUDIO_BYTES', 10), patch('paramyth.soundtracks.audio', return_value=Response(b'x' * 100)):
            with self.assertRaisesRegex(ProviderError, 'size limit'):
                soundtracks.download(JOB, out)


if __name__ == '__main__':
    unittest.main()
