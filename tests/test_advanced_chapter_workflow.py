import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from paramyth.pipeline import creative_studio, media_workspace, production
from paramyth.pipeline.storage import save
from tests.test_production import breakdown


class ChapterWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        save(self.root/'author-workspace.json',{'brief':{'premise':'A keeper guards a bell'},'scenes':[
            {'id':'first','chapter':1,'title':'Arrival','content':'Ada finds the key.'},
            {'id':'second-a','chapter':2,'title':'The bell','content':'She unlocks the door.'},
            {'id':'second-b','chapter':2,'title':'Current scene','content':'Do not repeat this scene.'},
            {'id':'future','chapter':3,'title':'Future','content':'Do not leak this ending.'}]})

    def test_chapter_continuity_excludes_current_and_future_scenes(self):
        text=json.dumps(creative_studio.chapter_context(self.root,2,'second-b'))
        self.assertIn('Ada finds',text);self.assertIn('unlocks the door',text)
        self.assertNotIn('repeat this scene',text);self.assertNotIn('leak this ending',text)

    def test_chapter_validation_rejects_invalid_indices(self):
        for chapter in (-1,101,True,'2'):
            with self.subTest(chapter=chapter),self.assertRaises(ValueError):creative_studio.validate({'chapter':chapter})

    def test_live_source_changes_without_waiting_for_completion(self):
        row={'id':'draft','created_at':'2026','status':'running','request':{'operation':'draft','chapter':2,'scene_id':'second-b'},'preview':{'stage':'Draft','title':'The bell','text':'She heard a footstep.'}}
        save(self.root/'creative'/'draft.json',row)
        first=media_workspace.material(self.root)
        self.assertEqual(first['status'],'running');self.assertIn('Ada finds',json.dumps(first))
        self.assertNotIn('leak this ending',json.dumps(first))
        row['preview']['text']+=' Someone was climbing the stairs.';save(self.root/'creative'/'draft.json',row)
        second=media_workspace.material(self.root)
        self.assertNotEqual(first['signature'],second['signature'])
        self.assertIn('climbing',media_workspace.catalog(self.root)['current']['excerpt'])
        row.update(status='complete',result=row['preview']);save(self.root/'creative'/'draft.json',row)
        self.assertEqual(media_workspace.material(self.root)['source_id'],'draft')

    def test_media_snapshot_is_immutable_and_manual_direction_has_separate_signature(self):
        row={'id':'draft','created_at':'2026','status':'running','request':{'operation':'draft'},'preview':{'stage':'Draft','text':'The original live words'}}
        save(self.root/'creative'/'draft.json',row)
        snapshot=media_workspace.material(self.root,manual='A tiny crew')
        base=media_workspace.material(self.root)
        self.assertEqual(snapshot['writing_signature'],base['signature'])
        self.assertNotEqual(snapshot['signature'],base['signature'])
        row['preview']['text']='New words';save(self.root/'creative'/'draft.json',row)
        self.assertIn('original live',json.dumps(snapshot));self.assertNotIn('New words',json.dumps(snapshot))

    def test_latest_follows_manual_edits_but_saved_versions_remain_unchanged(self):
        save(self.root/'creative'/'draft.json',{'id':'draft','created_at':'2026','status':'complete','request':{'operation':'draft','scene_id':'first'},'result':{'title':'Old title','text':'Original words'}})
        save(self.root/'workspace-drafts.json',{'writing.edits':{'first':{'base':'draft','title':'Edited title','text':'My changed words'}}})
        self.assertIn('My changed words',json.dumps(media_workspace.material(self.root)))
        self.assertIn('Original words',json.dumps(media_workspace.material(self.root,'draft')))

    def test_automatic_region_reaches_search_even_without_model_queries(self):
        direction={'brief':'Small crew and a practical lighthouse interior','region':'Portland, Maine, United States','reason':'Coastal architecture','sound_prompt':'Quiet strings','assumptions':['Region is a proposal'],'image_prompts':[{'title':'The keeper','prompt':'A weathered keeper beside a brass bell'}]}
        advice={'summary':'Shoot the interior first','locations':[],'legal_logistics':[],'crew_equipment':[],'risks':[],'next_steps':['Scout the coast']}
        with patch.object(production,'Muse') as muse,patch.object(production,'Search') as search:
            muse.return_value.ask.side_effect=[direction,breakdown(),advice];muse.return_value.calls=[];muse.return_value.provider='Test';muse.return_value.model='Test'
            search.return_value.search.return_value={'results':[],'retrieved_at':1,'evidence_level':'search_snippet_only'}
            result=production.create_plan(self.root,{'auto_region':True,'search_limit':2},sources=[{'file':'draft','text':'A keeper climbs a lighthouse'}])
        self.assertEqual(result['config']['region'],direction['region'])
        self.assertEqual(search.return_value.search.call_count,2)
        self.assertIn('Portland',search.return_value.search.call_args.args[0])
        self.assertEqual(result['starter']['image_prompts'][0]['title'],'The keeper')

    def test_explicit_region_is_preserved_in_generated_direction(self):
        model=unittest.mock.Mock()
        model.ask.return_value={'brief':'Use practical sets','region':'A different city','reason':'An option','sound_prompt':'Strings','image_prompts':[],'assumptions':[]}
        value=production.prepare_direction([{'file':'draft','text':'Story'}],{'region':'Chicago'},model)
        self.assertEqual(value['region'],'Chicago')

    def test_current_source_follows_active_chapter_and_manual_manuscript_edits(self):
        save(self.root/'creative'/'unrelated.json',{'id':'other','created_at':'2099','status':'complete','request':{'operation':'ideas'},'result':{'text':'Unrelated newest idea'}})
        save(self.root/'workspace-drafts.json',{'writing.chapter':1,'writing.sceneIds':{'1':'first'},'writing.edits':{'first':{'base':'manuscript','title':'Edited arrival','text':'Ada keeps a silver key.'}}})
        selected=media_workspace.catalog(self.root)['current']
        self.assertEqual(selected['excerpt'],'Ada keeps a silver key.')
        self.assertEqual(selected['title'],'Edited arrival')
        self.assertNotIn('Unrelated',json.dumps(media_workspace.material(self.root)))
        self.assertIn('silver key',json.dumps(creative_studio.chapter_context(self.root,2,'second-a')))

    def test_active_chapter_stream_replaces_previous_version_and_keeps_edited_version(self):
        row={'id':'live','created_at':'2026','status':'running','request':{'operation':'draft','chapter':2,'scene_id':'second-a'},'preview':{'stage':'Draft','text':'New words arriving'}}
        save(self.root/'creative'/'live.json',row)
        save(self.root/'workspace-drafts.json',{'writing.chapter':2,'writing.sceneIds':{'2':'second-a'}})
        self.assertEqual(media_workspace.catalog(self.root)['current']['excerpt'],'New words arriving')
        row.update(status='complete',result={'title':'New chapter','text':'New words complete'})
        save(self.root/'creative'/'live.json',row)
        save(self.root/'workspace-drafts.json',{'writing.chapter':2,'writing.sceneIds':{'2':'second-a'},'writing.edits':{'second-a':{'base':'live','title':'My title','text':'My final wording'}}})
        self.assertEqual(media_workspace.catalog(self.root)['current']['excerpt'],'My final wording')
        self.assertIn('My final wording',json.dumps(creative_studio.chapter_context(self.root,3,'future')))

    def test_chapter_idea_source_is_scoped_and_explicit_saved_output_is_unchanged(self):
        save(self.root/'workspace-drafts.json',{'writing.chapter':2,'creative.input':'First chapter idea','creative.chapter2.input':'Next chapter idea'})
        self.assertIn('Next chapter idea',json.dumps(media_workspace.material(self.root,'working')))
        self.assertNotIn('First chapter idea',json.dumps(media_workspace.material(self.root,'working')))
        with self.assertRaises(ValueError):creative_studio.validate({'context_chapter':101})

    def test_feedback_never_replaces_chapter_prose(self):
        save(self.root/'creative'/'review.json',{'id':'review','created_at':'2099','status':'complete','request':{'operation':'review','scene_id':'first'},'result':{'text':'Feedback instead of prose'}})
        self.assertEqual(creative_studio.scene_output(self.root,{'id':'first','title':'First','content':'Original prose'})['text'],'Original prose')

    def test_targeted_revision_preserves_surrounding_text_and_stream(self):
        previews=[]
        def completion(*args,**kwargs):
            body=json.dumps({'title':'Revised','text':'A new ending.','assumptions':[]})
            args[4](body)
            return {'choices':[{'message':{'content':body},'finish_reason':'stop'}]}
        with patch.object(creative_studio.creative_stream,'configuration',return_value=('test','test')),patch.object(creative_studio.creative_stream,'completion',side_effect=completion):
            result=creative_studio.run(self.root,{'operation':'revise','text':'Unchanged opening. Old ending. Unchanged closing.','target_passage':'Old ending.','use_story':False},lambda message,**kw:previews.append(kw.get('preview')),stream=True)
        expected='Unchanged opening. A new ending. Unchanged closing.'
        self.assertEqual(result['result']['text'],expected)
        self.assertTrue(any(p and p.get('text')==expected for p in previews))
        with self.assertRaises(ValueError):creative_studio.validate({'operation':'revise','text':'same same','target_passage':'same'})
