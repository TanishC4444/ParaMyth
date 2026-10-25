"""Reference uploads stay project-scoped and reach Muse as image inputs."""
import base64
import io
import json
import os
from unittest.mock import patch

from PIL import Image, PngImagePlugin

from paramyth import image_references as refs, image_studio
from paramyth.pipeline import image_studio as renderer
from test_images import png, response
from test_studio_projects import StudioTestCase, wait

KEY = {'MUSE_IMAGE_API_KEY': 'test-image-key', 'MODEL_API_KEY': ''}


class ReferenceImageTests(StudioTestCase):
    def setUp(self):
        super().setUp()
        self.ident = self.project(text='Aster is a bronze smith at the forge.')
        self.query = {'project_id': self.ident}
        self.headers = {'X-ParaMyth-Token': self.token}
        self.folder = self.runtime.folder(self.ident)

    def upload(self, blob=None, name='reference.png'):
        return self.client.post('/api/images/references', params={**self.query, 'name': name},
            content=png() if blob is None else blob, headers={**self.headers, 'Content-Type': 'image/png'})

    def settings(self, ids):
        return {'model': 'muse-image-1.0', 'prompt': 'Keep the face, change the coat to blue.',
                'kind': 'character', 'reference_ids': ids}

    def test_upload_list_preview_and_project_isolation(self):
        uploaded = self.upload(name='../../portrait.png')
        self.assertEqual(uploaded.status_code, 201, uploaded.text)
        reference = uploaded.json()
        self.assertEqual(reference['name'], 'portrait.png')
        self.assertEqual((reference['width'], reference['height']), (64, 64))
        self.assertNotIn('file', reference)
        listed = self.client.get('/api/images/references', params=self.query).json()['references']
        self.assertEqual(listed, [reference])
        preview = self.client.get('/media/image-references/' + reference['id'], params=self.query)
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.headers['cache-control'], 'no-store')
        other = self.project('Other project', 'An unrelated story')
        query = {'project_id': other}
        self.assertEqual(self.client.get('/api/images/references', params=query).json()['references'], [])
        self.assertEqual(self.client.get('/media/image-references/' + reference['id'], params=query).status_code, 422)
        with patch.dict(os.environ, KEY), patch.object(image_studio, 'request_json') as provider:
            rejected = self.client.post('/api/images/generate', params=query,
                json=self.settings([reference['id']]), headers=self.headers)
        self.assertEqual(rejected.status_code, 422)
        self.assertFalse(self.runtime.jobs)
        provider.assert_not_called()

    def test_upload_requires_write_token_and_rejects_foreign_origin(self):
        self.assertEqual(self.client.post('/api/images/references', params=self.query, content=png()).status_code, 403)
        self.assertEqual(self.client.post('/api/images/references', params=self.query, content=png(),
            headers={**self.headers, 'Origin': 'https://untrusted.example'}).status_code, 403)
        self.assertFalse((self.folder / 'image-references').exists())

    def test_invalid_oversized_and_animated_uploads_are_rejected(self):
        for blob in (b'', b'<svg xmlns="http://www.w3.org/2000/svg"/>', png()[:30], png(5000, 4000)):
            self.assertEqual(self.upload(blob).status_code, 422)
        self.assertEqual(self.upload(b'x' * (refs.MAX_UPLOAD_BYTES + 1)).status_code, 413)
        output = io.BytesIO()
        Image.new('RGB', (10, 10), 'red').save(output, 'WEBP', save_all=True,
            append_images=[Image.new('RGB', (10, 10), 'blue')], duration=100)
        self.assertEqual(self.upload(output.getvalue()).status_code, 422)
        self.assertFalse((self.folder / 'image-references').exists())

    def test_normalization_accepts_formats_strips_metadata_and_preserves_alpha(self):
        for mode, format in (('RGB', 'JPEG'), ('RGB', 'WEBP'), ('RGBA', 'PNG')):
            output = io.BytesIO()
            image = Image.new(mode, (2200, 50), (25, 50, 75, 80) if mode == 'RGBA' else (25, 50, 75))
            metadata = PngImagePlugin.PngInfo()
            metadata.add_text('private-note', 'do-not-send-metadata')
            image.save(output, format, **({'pnginfo': metadata} if format == 'PNG' else {}))
            result = self.upload(output.getvalue(), 'photo.' + format.lower())
            self.assertEqual(result.status_code, 201, result.text)
            value, path = refs.read_reference(self.folder, result.json()['id'])
            self.assertLessEqual(value['width'], 2048)
            with Image.open(path) as normalized:
                self.assertNotIn('private-note', normalized.info)
                self.assertEqual('A' in normalized.getbands(), mode == 'RGBA')
            self.assertNotIn(b'do-not-send-metadata', path.read_bytes())

    def test_uploaded_pixels_and_prompt_reach_muse_without_bytes_in_record(self):
        ids = [self.upload().json()['id'], self.upload().json()['id']]
        with patch.dict(os.environ, KEY), patch.object(image_studio, 'request_json', return_value=response()) as provider:
            started = self.client.post('/api/images/generate', params=self.query, json=self.settings(ids), headers=self.headers)
            self.assertEqual(started.status_code, 202, started.text)
            job = wait(self.runtime, started.json()['job_id'])
        self.assertEqual(job['status'], 'complete', job)
        payload = provider.call_args.args[1]
        self.assertFalse(payload['store'])
        message = payload['input'][0]
        self.assertEqual(message['role'], 'user')
        self.assertEqual(message['content'][0], {'type': 'input_text', 'text': self.settings(ids)['prompt']})
        for ident, part in zip(ids, message['content'][1:]):
            value, path = refs.read_reference(self.folder, ident)
            self.assertEqual(part['type'], 'input_image')
            self.assertEqual(base64.b64decode(part['image_url'].split(',', 1)[1]), path.read_bytes())
        record = image_studio.read_record(self.folder, job['result']['id'])
        self.assertEqual(record['reference_ids'], ids)
        self.assertNotIn('data:image', json.dumps(record))

    def test_reference_validation_starts_no_jobs_or_provider_calls(self):
        ident = self.upload().json()['id']
        for ids in ('https://example.com/photo.jpg', ['../private'], [ident] * 2, ['a' * 24] * 4):
            with patch.dict(os.environ, KEY), patch.object(image_studio, 'request_json') as provider:
                self.assertEqual(self.client.post('/api/images/generate', params=self.query,
                    json=self.settings(ids), headers=self.headers).status_code, 422)
            provider.assert_not_called()
        self.assertFalse(self.runtime.jobs)

    def test_automatic_story_route_passes_references_to_renderer(self):
        ids = [self.upload().json()['id']]
        data = {**self.settings(ids), 'source': 'manuscript', 'enhance': False}
        with patch.dict(os.environ, KEY), patch.object(renderer.CATALOG, 'get', return_value=renderer.MUSE_MODEL), \
                patch.object(renderer, 'request_json', return_value=response()) as provider:
            started = self.client.post('/api/images/create', params=self.query, json=data, headers=self.headers)
            self.assertEqual(started.status_code, 202, started.text)
            job = wait(self.runtime, started.json()['job_id'])
        self.assertEqual(job['status'], 'complete', job)
        self.assertEqual(provider.call_args.args[1]['input'][0]['content'][1]['type'], 'input_image')
        self.assertEqual(job['result']['reference_ids'], ids)

    def test_reference_edits_never_fall_back_to_a_text_only_model(self):
        ids = [self.upload().json()['id']]
        with patch.dict(os.environ, KEY), patch.object(renderer.CATALOG, 'get', return_value=renderer.MUSE_MODEL), \
                patch.object(renderer.CATALOG, 'vultr_list') as backup, \
                patch.object(renderer, 'request_json', side_effect=ValueError('Muse unavailable')) as provider:
            with self.assertRaisesRegex(ValueError, 'Muse unavailable'):
                renderer.generate(self.folder, self.settings(ids))
        provider.assert_called_once()
        backup.assert_not_called()

    def test_other_models_cannot_silently_ignore_references(self):
        ident = self.upload().json()['id']
        with self.assertRaisesRegex(ValueError, 'Choose Muse Image'):
            refs.validate_references(self.folder, {'model': 'other-image-model', 'reference_ids': [ident]})
