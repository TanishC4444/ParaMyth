import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from paramyth.pipeline.api.app import app
from paramyth.pipeline.api.studio_routes import get_runtime
from paramyth.pipeline.api.studio_runtime import StudioRuntime
from paramyth.pipeline.api.ui_workspace import project
from paramyth.pipeline.soundtracks import context
from paramyth.pipeline.storage import save,load

class AuthorWorkspaceTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  self.root=Path(self.temp.name);self.runtime=StudioRuntime(self.root);self.addCleanup(self.runtime.pool.shutdown)
  app.dependency_overrides[get_runtime]=lambda:self.runtime;self.addCleanup(app.dependency_overrides.clear)
  self.client=TestClient(app);self.addCleanup(self.client.close)
  self.headers={'X-ParaMyth-Token':self.runtime.token}
 def create(self):
  ident=self.runtime.create_project('Original story','The original manuscript.',{'title':'Original story','premise':'A choice at sea.','characters':[]})
  p=project(self.runtime,ident)
  p['brief']['characters']=[{'id':'sailor','name':'Sailor','goal':'Return','fear':'Loss','voice':'Direct','arc':{'belief':'Duty','pressure':'A storm','choice':'Stay','change':'Trust'}}]
  return ident,p
 def put(self,p):return self.client.put('/api/ui/projects/'+p['id'],json=p,headers=self.headers)
 def test_workspace_drafts_survive_restart_and_patch_without_replacing_other_tabs(self):
  ident,_=self.create();route='/api/ui/projects/'+ident+'/workspace'
  first={'creative.input':'A keeper at sea','images.prompt':'A blue lighthouse','images.pendingJob':{'id':'a'*24,'kind':'image'}}
  self.assertEqual(self.client.patch(route,json=first,headers=self.headers).status_code,200)
  self.assertEqual(self.client.patch(route,json={'music.lyrics':'Return home','creative.input':'A keeper returns'},headers=self.headers).status_code,200)
  restored=StudioRuntime(self.root);self.addCleanup(restored.pool.shutdown)
  app.dependency_overrides[get_runtime]=lambda:restored
  drafts=self.client.get('/api/ui/workspace').json()['drafts'][ident]
  self.assertEqual(drafts['creative.input'],'A keeper returns')
  self.assertEqual(drafts['images.prompt'],first['images.prompt'])
  self.assertEqual(drafts['images.pendingJob'],first['images.pendingJob'])
  self.assertEqual(drafts['music.lyrics'],'Return home')
  self.assertEqual(self.client.patch(route,json={'images.pendingJob':None},headers={'X-ParaMyth-Token':restored.token}).status_code,200)
  self.assertIsNone(self.client.get('/api/ui/workspace').json()['drafts'][ident]['images.pendingJob'])
 def test_workspace_drafts_are_project_scoped_and_protected(self):
  first,_=self.create();second=self.runtime.create_project('Other story','Another story')
  route='/api/ui/projects/'+first+'/workspace'
  self.assertEqual(self.client.patch(route,json={'creative.input':'Private draft'}).status_code,403)
  self.assertEqual(self.client.patch(route,json={'creative.input':'Saved draft'},headers=self.headers).status_code,200)
  self.assertEqual(self.client.get('/api/ui/workspace').json()['drafts'][second],{})
  for body in ({'../escape':'bad'},{'images.prompt':'x'*2000001}):
   self.assertEqual(self.client.patch(route,json=body,headers=self.headers).status_code,422)
  self.assertEqual(self.client.get('/api/ui/workspace').json()['drafts'][first],{'creative.input':'Saved draft'})
 def test_empty_workspace_does_not_invent_a_story(self):
  self.assertEqual(self.client.get('/api/ui/workspace').json()['projects'],[])
  self.assertFalse((self.root/'runs'/'studio-projects').exists())
 def test_character_deletion_persists_with_revision_and_original_backup(self):
  ident,p=self.create();original=(self.runtime.folder(ident)/'story.txt').read_text(encoding='utf8')
  r=self.put(p);self.assertEqual(r.status_code,200,r.text);p=r.json()
  p['brief']['characters']=[];r=self.put(p);self.assertEqual(r.status_code,200,r.text)
  root=self.runtime.folder(ident)
  self.assertEqual(load(root/'request.json')['characters'],[])
  self.assertEqual(project(self.runtime,ident)['brief']['characters'],[])
  self.assertEqual((root/'story.txt').read_text(encoding='utf8'),original)
  self.assertTrue((root/'author-original-request.json').exists())
  self.assertEqual(len(list((root/'author-revisions').glob('*.json'))),1)
  self.assertEqual(self.put(p).status_code,409)
 def test_edits_are_the_media_context_without_overwriting_accepted_outputs(self):
  ident,p=self.create();root=self.runtime.folder(ident);save(root/'FINAL_STORY.txt','Accepted historical prose')
  p['scenes'][0]['content']='The author changed the shore to a desert.'
  self.assertEqual(self.put(p).status_code,200)
  sources=context(root)
  self.assertEqual(sources[0]['file'],'author-draft.txt')
  self.assertIn('desert',sources[0]['text'])
  self.assertNotIn('FINAL_STORY.txt',[s['file'] for s in sources])
  self.assertEqual((root/'FINAL_STORY.txt').read_text(),'Accepted historical prose')
 def test_invalid_nested_edits_fail_before_writing(self):
  ident,p=self.create();p['brief']['characters'][0]['arc']=None
  self.assertEqual(self.put(p).status_code,422)
  self.assertFalse((self.runtime.folder(ident)/'author-workspace.json').exists())
  self.assertEqual(self.client.post('/api/ui/projects',json={'project':p},headers=self.headers).status_code,422)
  self.assertEqual(len(self.runtime.projects),1)
 def test_request_length_uses_runner_contract(self):
  ident,p=self.create();self.assertEqual(self.put(p).status_code,200)
  r=load(self.runtime.folder(ident)/'request.json');self.assertIsInstance(r['words_per_scene'],int);self.assertEqual(r['medium'],'book')
 def test_fixtures_are_excluded(self):
  ident,p=self.create();save(self.runtime.folder(ident)/'state.json',{'backend':'fixture'})
  self.assertEqual(self.client.get('/api/ui/workspace').json()['projects'],[])
 def test_search_maps_real_corpus_results_to_globe(self):
  r=self.client.post('/api/ui/search',json={'query':'a dangerous bargain at sea','mode':'lexical'})
  self.assertEqual(r.status_code,200,r.text);value=r.json()
  self.assertTrue(value['sources']);self.assertTrue(any(s['atlas_id'] for s in value['sources']))
  self.assertIn('corpus_sha256',value);self.assertIn('retrieval_hits',value['sources'][0])
  self.assertEqual(self.client.post('/api/ui/search',json={'query':'!!!'}).status_code,200)
 def test_atlas_returns_multiple_distinct_stories_and_honors_limit(self):
  for count in (6,8,12):
   r=self.client.post('/api/ui/search',json={'query':'a dangerous bargain at sea','mode':'lexical','limit':count})
   self.assertEqual(r.status_code,200,r.text);sources=r.json()['sources']
   self.assertEqual(len(sources),count)
   self.assertEqual(len({s['atlas_id'] or s['canonical_id'] for s in sources}),count)
  for count in (0,21,True,'8'):
   self.assertEqual(self.client.post('/api/ui/search',json={'query':'sea','limit':count}).status_code,422)
 def test_semantic_search_emphasizes_meaning_without_changing_writer_defaults(self):
  with patch('paramyth.pipeline.rag.embeddings.api_key',return_value='configured'),patch('paramyth.pipeline.retrieval.retrieve',return_value={'sources':[]}) as retrieve:
   r=self.client.post('/api/ui/search',json={'query':'a soldier returning home','mode':'hybrid','limit':12})
  self.assertEqual(r.status_code,200)
  args=retrieve.call_args
  self.assertEqual(args.kwargs['source_limit'],20)
  self.assertEqual(args.args[0]['retrieval_weights']['semantic_similarity'],.95)
  self.assertTrue(args.kwargs['group_ids'])
 def test_semantic_failure_is_actionable(self):
  with patch('paramyth.pipeline.rag.embeddings.api_key',side_effect=RuntimeError()):
   r=self.client.post('/api/ui/search',json={'query':'a bargain','mode':'hybrid'})
  self.assertEqual(r.status_code,503);self.assertIn('Connections',r.json()['detail'])
 def test_review_evidence_and_editorial_canon_are_visible(self):
  ident,p=self.create();root=self.runtime.folder(ident)
  save(root/'state.json',{'accepted':[{'id':'s1','prose':'A doubtful passage.','review':{'issues':[{'severity':'blocking','quote':'doubtful','problem':'Contradiction','fix':'Repair'}]}}]})
  save(root/'final-state.json',{'scenes':[{'id':'s1','facts':{'location':'Shore'}}]})
  actual=project(self.runtime,ident);self.assertEqual(actual['scenes'][0]['findings'][0]['severity'],'Blocking')
  self.assertEqual(actual['canon'][0]['text'],'location: Shore')
 def test_bridge_rejects_foreign_origins_before_forwarding(self):
  with patch.dict(os.environ,{'PARAMYTH_ACCOUNT_ORIGIN':'http://127.0.0.1:8767'}),patch('httpx.AsyncClient') as upstream:
   r=self.client.post('/api/v1/accounts/signup',json={},headers={'Origin':'https://foreign.example'})
   self.assertEqual(r.status_code,403);upstream.assert_not_called()

if __name__=='__main__':unittest.main()
