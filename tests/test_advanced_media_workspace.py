"""Shared workflow contracts: current inputs, isolated assets and durable jobs."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from starlette.requests import Request
from paramyth.pipeline import media_workspace as media, creative_studio, creative_stream, storage
from paramyth.pipeline.api.studio_runtime import StudioRuntime
from paramyth.pipeline.api.ui_workspace import current_production


class MediaWorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        storage.save(self.root/'story.txt','Old bronze story')
        storage.save(self.root/'creative'/('a'*24+'.json'),{'id':'a'*24,'status':'complete','created_at':'2026-10-24','request':{'operation':'draft'},'result':{'title':'Winter','text':'Ksenia walks through cold forest.'}})

    def test_selected_writing_never_includes_original_story(self):
        selected=media.material(self.root)
        self.assertEqual(selected['source_id'],'a'*24)
        self.assertIn('Ksenia',json.dumps(selected))
        self.assertNotIn('bronze',json.dumps(selected))
        self.assertIn('bronze',json.dumps(media.material(self.root,'manuscript')))
        manual=media.material(self.root,manual='Only my brief',use_story=False)
        self.assertEqual(manual['source_id'],'manual')
        self.assertNotIn('Ksenia',json.dumps(manual))
        with self.assertRaises(ValueError):media.material(self.root,'foreign-id')
        storage.save(self.root/'workspace-drafts.json',{'creative.input':'My latest editor changes'})
        self.assertEqual(media.material(self.root,'working')['sources'][0]['text'],'My latest editor changes')

    def test_author_draft_supersedes_historical_scenes(self):
        storage.save(self.root/'author-draft.txt','Current revised manuscript')
        storage.save(self.root/'scenes'/'old.txt','Historical bronze story')
        value=json.dumps(media.material(self.root,'manuscript'))
        self.assertIn('Current revised',value);self.assertNotIn('bronze',value)

    def test_automatic_music_uses_current_writing_and_provider_limits(self):
        model={'id':'music-model','duration':{'min':30,'max':120}}
        with patch.object(media,'Muse') as muse:
            muse.return_value.ask.return_value={'mode':'score','seconds':500,'prompt':'Soft piano','model':'music-model'}
            settings=media.music_settings(self.root,{},[model])
        self.assertEqual(settings['seconds'],120)
        self.assertIn('Ksenia',settings['cue']['prompt'])
        self.assertNotIn('bronze',settings['cue']['prompt'])
        self.assertIn('Ksenia',json.dumps(muse.return_value.ask.call_args.args))

    def test_music_preserves_full_author_prompt_and_explicit_settings(self):
        prompt='Soft solo piano. '+('Keep a slow even pulse. '*30)+'No drums, strings or brass.'
        with patch.object(media,'Muse') as muse:
            settings=media.music_settings(self.root,{'prompt':prompt,'automatic':True,'mode':'score','seconds':45,'use_story':False},[{'id':'model','duration':{'min':30,'max':120}}])
        muse.assert_not_called()
        self.assertEqual(settings['prompt'],prompt)
        self.assertEqual(settings['seconds'],45)
        self.assertEqual(settings['mode'],'score')
        self.assertIn(prompt,settings['cue']['prompt'])
        self.assertNotIn('Ksenia',settings['cue']['prompt'])

    def test_legacy_transport_preserves_instrumental_intent_and_full_prompt(self):
        prompt='Solo piano. '+('Gentle sustained notes. '*30)+'No percussion or brass.'
        def remote(path,data=None,project_id=None):
            if data:
                self.assertEqual(data['mode'],'song')
                self.assertIn('[Instrumental]',data['lyrics'])
                snapshot=next((self.root/'.media-inputs').glob('*/story.txt')).read_text(encoding='utf-8')
                self.assertIn(prompt,snapshot)
                return {'job_id':'remote-job'}
            return {'status':'complete','result':{'job':{'id':'music_result','status':'completed'},'cue':{}}}
        with patch.dict(os.environ,{'VULTR_INFERENCE_API_KEY':''}),patch.object(media,'music_models',return_value=[{'id':'model'}]),patch.object(media,'service_json',side_effect=remote):
            value=media.create_music(self.root,{'prompt':prompt,'mode':'score','seconds':30,'use_story':False},lambda _:None)
        self.assertEqual(value['cue']['mode'],'score')
        self.assertEqual(value['settings']['prompt'],prompt)

    def test_ambience_is_real_audio_and_keeps_selected_source(self):
        result=media.create_music(self.root,{'mode':'ambience','automatic':False,'seconds':5},lambda _:None)
        self.assertEqual(result['source_id'],'a'*24)
        self.assertTrue((self.root/'soundtracks'/result['file']).read_bytes().startswith(b'RIFF'))
        self.assertEqual(len(media.catalog(self.root)['tracks']),1)

    def test_remote_music_uses_immutable_snapshot_and_keeps_original(self):
        original=(self.root/'story.txt').read_bytes()
        def remote(path,data=None,project_id=None):
            if data:
                snapshot=next((self.root/'.media-inputs').glob('*/story.txt'))
                self.assertIn('Ksenia',snapshot.read_text());self.assertNotIn('bronze',snapshot.read_text())
                self.assertEqual(len(project_id),16)
                return {'job_id':'remote-job'}
            return {'status':'complete','result':{'job':{'id':'music_result','status':'completed'},'cue':{},'provider':'Vultr'}}
        with patch.dict(os.environ,{'VULTR_INFERENCE_API_KEY':''}),patch.object(media,'music_models',return_value=[{'id':'model'}]),patch.object(media,'service_json',side_effect=remote):
            result=media.create_music(self.root,{'automatic':False,'mode':'score','seconds':30},lambda _:None)
        self.assertEqual(original,(self.root/'story.txt').read_bytes())
        self.assertIn('Ksenia',result['cue']['prompt'])
        self.assertTrue((self.root/'soundtracks'/'music_result.json').exists())

    def test_plan_captures_writing_and_selected_media_before_worker_runs(self):
        runtime=StudioRuntime(self.root);self.addCleanup(runtime.pool.shutdown)
        pid=runtime.create_project('Project','Original story');folder=runtime.folder(pid)
        storage.save(folder/'creative'/('a'*24+'.json'),storage.load(self.root/'creative'/('a'*24+'.json')))
        storage.save(folder/'soundtracks'/'track.json',{'job':{'status':'completed'},'cue':{'prompt':'Quiet strings'}})
        request=Request({'type':'http','method':'POST','path':'/','query_string':('project_id='+pid).encode(),'headers':[]})
        with patch.object(runtime,'submit',return_value='job') as submit,patch('paramyth.pipeline.image_studio.image_file',return_value=self.root/'reference.png'),patch('paramyth.pipeline.production.create_plan',return_value={'id':'plan'}) as create:
            (self.root/'reference.png').write_bytes(b'image')
            current_production(request,{'source':'latest','image_ids':['image'],'track_ids':['track']},runtime)
        operation=submit.call_args.args[2]
        storage.save(folder/'creative'/('b'*24+'.json'),{'id':'b'*24,'status':'complete','created_at':'2027','result':{'text':'Different story'}})
        result=operation(lambda _:None)
        self.assertEqual(result['source_id'],'a'*24)
        sources=create.call_args.kwargs['sources']
        self.assertIn('Ksenia',json.dumps(sources));self.assertIn('Quiet strings',json.dumps(sources))
        self.assertNotIn('Different story',json.dumps(sources))
        self.assertEqual(len(create.call_args.args[2]),1)
        with self.assertRaises(ValueError):current_production(request,{'track_ids':['../../elsewhere']},runtime)

    def test_transient_draft_failure_retries_same_saved_record(self):
        good={'choices':[{'message':{'content':'{"title":"Winter","text":"A complete draft."}'},'finish_reason':'stop'}]}
        for first in (creative_stream.StreamError('Connection dropped'),{'choices':[{'message':{'content':'{"text":"unfinished'}}]}):
            with self.subTest(first=type(first).__name__),patch.object(creative_stream,'configuration',return_value=('Gemini','model')),patch.object(creative_stream,'completion',side_effect=[first,good]) as call,patch('paramyth.pipeline.creative_studio.time.sleep'):
                result=creative_studio.run(self.root,{'operation':'draft','use_story':False},lambda _,**kw:None,stream=True)
            self.assertEqual(result['status'],'complete');self.assertEqual(call.call_count,2)
            self.assertEqual(len(result['attempts']),1)
            self.assertEqual(storage.load(self.root/'creative'/(result['id']+'.json'))['result']['text'],'A complete draft.')

    def test_retry_limit_and_permanent_failure(self):
        for retryable,expected in ((True,3),(False,1)):
            with patch.object(creative_stream,'configuration',return_value=('Gemini','model')),patch.object(creative_stream,'completion',side_effect=creative_stream.StreamError('Unavailable',retryable=retryable)) as call,patch('paramyth.pipeline.creative_studio.time.sleep'):
                with self.assertRaises(creative_stream.ProviderError):creative_studio.run(self.root,{'operation':'draft','use_story':False},lambda _,**kw:None,stream=True)
            self.assertEqual(call.call_count,expected)

    def test_file_lock_retries_same_atomic_write(self):
        replace=os.replace;calls=[]
        def locked(source,target):
            calls.append(source)
            if len(calls)<3:raise PermissionError('Sync lock')
            replace(source,target)
        with patch('paramyth.pipeline.storage.os.replace',side_effect=locked),patch('paramyth.pipeline.storage.time.sleep'):
            storage.save(self.root/'saved.json',{'saved':True})
        self.assertEqual(len(set(calls)),1)
        self.assertTrue(storage.load(self.root/'saved.json')['saved'])


if __name__=='__main__':unittest.main()
