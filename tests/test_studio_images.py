"""Image routes: prompt preparation, Meta generation jobs and serving PNGs."""
import os
import unittest
from unittest.mock import patch

from test_images import response
from test_studio_projects import StudioTestCase, wait

IMAGE_KEY = {'MUSE_IMAGE_API_KEY': 'test-image-key', 'MODEL_API_KEY': ''}


class ImageRouteTests(StudioTestCase):
    def setUp(self):
        super().setUp()
        self.ident = self.project(text='Aster is a bronze smith at the forge.')
        self.query = {'project_id': self.ident}
        self.headers = {'X-ParaMyth-Token': self.token}

    def test_local_prompt_job_returns_the_prepared_prompt(self):
        with patch('paramyth.vultr.request_json') as provider:
            started = self.client.post('/api/images/prepare', params=self.query, json={'subject': 'Aster', 'enhance': False}, headers=self.headers)
            job = wait(self.runtime, started.json()['job_id'])
        provider.assert_not_called()
        result = self.client.get('/api/job/' + job['id']).json()['prompt_result']
        self.assertIn('bronze smith', result['prompt'])
        self.assertEqual(result['prompt_provider'], 'local template')

    def test_generated_image_is_listed_and_served(self):
        settings = {'model': 'muse-image-1.0', 'prompt': 'Aster at the forge', 'kind': 'scene', 'title': 'Forge'}
        with patch.dict(os.environ, IMAGE_KEY), patch('paramyth.image_studio.request_json', return_value=response()):
            started = self.client.post('/api/images/generate', params=self.query, json=settings, headers=self.headers)
            self.assertEqual(started.status_code, 202, started.text)
            job = wait(self.runtime, started.json()['job_id'])
        self.assertEqual(job['status'], 'complete', job)
        image = self.client.get('/api/job/' + job['id']).json()['image_id']
        self.assertEqual(self.client.get('/api/images', params=self.query).json()['images'][0]['id'], image)
        self.assertEqual(self.client.get('/api/images/' + image, params=self.query).json()['status'], 'completed')
        png = self.client.get(f'/media/images/{image}/0.png', params=self.query)
        self.assertEqual((png.status_code, png.content[:4]), (200, b'\x89PNG'))
        self.assertEqual(self.client.get(f'/media/images/{image}/3.png', params=self.query).status_code, 422)

    def test_invalid_settings_and_missing_keys_start_no_job(self):
        bad = {'model': 'muse-image-1.0', 'prompt': '', 'kind': 'scene'}
        with patch.dict(os.environ, IMAGE_KEY):
            self.assertEqual(self.client.post('/api/images/generate', params=self.query, json=bad, headers=self.headers).status_code, 422)
        with patch.dict(os.environ, {'MUSE_IMAGE_API_KEY': '', 'MODEL_API_KEY': ''}):
            self.assertEqual(self.client.get('/api/images/models').status_code, 422)
        self.assertEqual(self.client.post('/api/images/prepare', params=self.query, json={'kind': 'mural'}, headers=self.headers).status_code, 422)
        self.assertEqual(self.runtime.jobs, {})


if __name__ == '__main__':
    unittest.main()
