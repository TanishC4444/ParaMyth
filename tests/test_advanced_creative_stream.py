"""Streaming contracts: real chunk decoding, durable previews and job replay."""
import asyncio
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from starlette.requests import Request
from fastapi import HTTPException
from paramyth.pipeline import creative_stream, creative_studio
from paramyth.pipeline.api.studio_runtime import StudioRuntime
from paramyth.pipeline.api.ui_workspace import creative_events, creative_job
from paramyth.pipeline.production_research import ProviderError


class StreamTests(unittest.TestCase):
    def test_partial_json_never_exposes_escapes_or_nested_text(self):
        raw=json.dumps({'title':'A title','text':'A "quote"\nAnd a dragon 🐉.', 'summary':'Done'})
        for end in range(len(raw)+1):
            fields=creative_stream.preview(raw[:end])
            for key,value in fields.items():
                self.assertTrue(json.loads(raw)[key].startswith(value), (end,fields))
        self.assertEqual(creative_stream.preview(raw),json.loads(raw))
        self.assertEqual(creative_stream.preview('{"nested":{"text":"secret"},"text":"hello'),{'text':'hello'})
        self.assertEqual(creative_stream.preview('{"text":"a\\uD83D'),{'text':'a'})

    def provider(self, provider, values):
        wire=''.join('data: '+json.dumps(v)+'\n\n' for v in values).encode()
        seen=[]
        with patch('paramyth.pipeline.creative_stream.urlopen',return_value=io.BytesIO(wire)) as call:
            result=creative_stream.completion(provider,'model',[{'content':'system'},{'content':'prompt'}],.6,seen.append)
        return result,seen,call

    def test_gemini_streams_text_and_skips_thought_parts(self):
        values=[{'candidates':[{'content':{'parts':[{'text':'private reasoning','thought':True},{'text':'{"text":"Hello'}]}}]},
                {'candidates':[{'content':{'parts':[{'text':' world"}'}]},'finishReason':'STOP'}],'usageMetadata':{'totalTokenCount':9}}]
        result,seen,call=self.provider('Gemini',values)
        self.assertEqual(seen,['{"text":"Hello','{"text":"Hello world"}'])
        self.assertEqual(result['usage']['totalTokenCount'],9)
        self.assertIn(':streamGenerateContent?alt=sse',call.call_args.args[0].full_url)

    def test_vultr_streams_deltas_and_preserves_usage(self):
        result,seen,_=self.provider('Vultr Serverless Inference',[
            {'choices':[{'delta':{'content':'{"text":"Hi'}}]},
            {'choices':[{'delta':{'content':'"}'},'finish_reason':'stop'}]},
            {'choices':[],'usage':{'total_tokens':4}}])
        self.assertEqual(len(seen),2)
        self.assertEqual(result['usage']['total_tokens'],4)

    def test_truncated_stream_is_not_a_completed_result(self):
        with self.assertRaisesRegex(ProviderError,'before completion'):
            self.provider('Gemini',[{'candidates':[{'content':{'parts':[{'text':'{"text":"Unfinished'}]},'finishReason':'MAX_TOKENS'}]}])

    def test_partial_draft_persists_before_completion_and_after_failure(self):
        for fail in (False,True):
            with self.subTest(fail=fail),tempfile.TemporaryDirectory() as root:
                folder=Path(root); updates=[]
                def provider(_provider,_model,_messages,_temperature,on_chunk,**kwargs):
                    on_chunk('{"title":"Story","text":"First words')
                    saved=json.loads(next((folder/'creative').glob('*.json')).read_text(encoding='utf-8'))
                    self.assertEqual(saved['status'],'running')
                    self.assertEqual(saved['preview']['text'],'First words')
                    self.assertEqual(updates[-1]['preview']['text'],'First words')
                    if fail:raise creative_stream.StreamError('Connection lost',retryable=False)
                    return {'choices':[{'message':{'content':'{"title":"Story","text":"First words finished."}'},'finish_reason':'stop'}]}
                with patch('paramyth.pipeline.creative_stream.configuration',return_value=('Gemini','model')),patch('paramyth.pipeline.creative_stream.completion',side_effect=provider) as call:
                    if fail:
                        with self.assertRaises(ProviderError):creative_studio.run(folder,{'operation':'draft','use_story':False},lambda message,**data:updates.append(data),stream=True)
                    else:creative_studio.run(folder,{'operation':'draft','use_story':False},lambda message,**data:updates.append(data),stream=True)
                self.assertEqual(call.call_count,1)
                saved=json.loads(next((folder/'creative').glob('*.json')).read_text(encoding='utf-8'))
                self.assertEqual(saved['status'],'failed' if fail else 'complete')
                self.assertEqual('result' in saved,not fail)

    def test_sse_reconnect_replays_latest_job_without_starting_work(self):
        async def scenario(runtime,folder,ident):
            async def receive():
                await asyncio.sleep(3600)
            request=Request({'type':'http','method':'GET','path':'/','query_string':('project_id='+runtime.project_id(folder)).encode(),'headers':[]},receive)
            with patch.object(runtime,'submit') as submit:
                response=await creative_events(ident,request,runtime)
                generator=response.body_iterator
                first=await anext(generator)
                self.assertIn('Partial draft',first)
                await generator.aclose() # Disconnect does not stop the worker.
                self.assertEqual(runtime.job(ident)['status'],'running')
                with runtime.guard:runtime.jobs[ident].update(status='complete',preview={'text':'Partial draft finished'})
                replay=await creative_events(ident,request,runtime)
                events=[item async for item in replay.body_iterator]
                self.assertEqual(len(events),1)
                self.assertIn('Partial draft finished',events[0])
                submit.assert_not_called()
        with tempfile.TemporaryDirectory() as root:
            runtime=StudioRuntime(root)
            try:
                pid=runtime.create_project('Story','Story text');folder=runtime.folder(pid)
                ident='a'*24
                runtime.jobs[ident]={'id':ident,'project_id':pid,'streaming':True,'status':'running','preview':{'text':'Partial draft'}}
                other=runtime.create_project('Other','Other story')
                request=Request({'type':'http','method':'GET','path':'/','query_string':('project_id='+other).encode(),'headers':[]})
                with self.assertRaises(HTTPException):creative_job(ident,request,runtime)
                asyncio.run(scenario(runtime,folder,ident))
            finally:runtime.pool.shutdown()

    def test_job_failure_is_terminal_and_restart_preserves_partial_text(self):
        with tempfile.TemporaryDirectory() as root:
            runtime=StudioRuntime(root)
            pid=runtime.create_project('Story','Story text')
            def operation(progress):
                progress('Draft',preview={'text':'Saved words'})
                raise ProviderError('Connection lost')
            ident=runtime.submit('creative',runtime.folder(pid),operation,streaming=True)
            runtime.pool.shutdown()
            self.assertEqual(runtime.job(ident)['status'],'failed')
            self.assertEqual(runtime.job(ident)['preview']['text'],'Saved words')
            runtime.jobs[ident]['status']='running';runtime.persist(ident)
            with patch.dict(os.environ,{'PARAMYTH_SERVICE_ORIGIN':'http://127.0.0.1:8000'}):restarted=StudioRuntime(root)
            try:
                self.assertEqual(restarted.job(ident)['status'],'interrupted')
                self.assertEqual(restarted.job(ident)['preview']['text'],'Saved words')
            finally:restarted.pool.shutdown()


if __name__=='__main__':unittest.main()
