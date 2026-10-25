import copy
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock,patch
import zipfile
from paramyth.pipeline import idea_development as ideas,creative_studio,production
from paramyth.pipeline.media import contract,validate_presentation
from paramyth.pipeline.production_intelligence import apply_price_evidence
from paramyth.pipeline.production_operations import DEPARTMENTS,develop_operations,reconcile_resources,research_logistics,schedule_tasks
from paramyth.pipeline.production_research import Search
from paramyth.pipeline.soundtracks import music_payload
from paramyth.pipeline.storage import save
from paramyth.pipeline.writing_exports import export_writing
from paramyth.pipeline.production_exports import calendar_ics,export
from tests.test_advanced_production import breakdown,scene


def operations():
    return {'departments':[{'id':key,'status':'planned','rationale':'Needed for scene s1','tasks':[{'id':'t'+str(i),'task':'Prepare '+label,'owner':'Producer','deliverable':'Approved '+label,'anchor':'first_shoot' if i<15 else 'last_shoot','offset_days':-10+i//2 if i<15 else i-14,'duration_hours':1,'dependencies':[],'scene_ids':['s1']}]} for i,(key,label) in enumerate(DEPARTMENTS.items())],
      'crew':[{'role':'Camera operator','count':2,'prep_days':1,'post_days':0,'daily_low':100,'daily_high':150,'basis':'Estimated only'}],
      'equipment':[{'item':'Camera kit','quantity':1,'rental_days':2,'daily_low':50,'daily_high':100,'purpose':'Scene s1','scene_ids':['s1']}],
      'sets':[{'name':'Temple','scene_ids':['s1'],'approach':'practical set','build_and_strike':'two-day build','props_continuity':'track lamp position','power_access_safety':'check power and exits'}],
      'assumptions':[],'constraints_conflicts':[],'arrival_airport':'OZZ'}


class WorkflowDepthTests(unittest.TestCase):
    def test_production_uses_its_vultr_connection_without_switching_writing(self):
        with patch.dict(os.environ, {'VULTR_PRODUCTION_API_KEY':'production-test-key','GEMINI_API_KEY':'writing-test-key'}, clear=True):
            planner=production.Muse()
            self.assertEqual(planner.provider,'Vultr Serverless Inference')
            self.assertEqual(planner.model,'muse-glimmer-30b')
            self.assertEqual(planner.key,'production-test-key')
            self.assertEqual(creative_studio.creative_stream.configuration()[0],'Gemini')

    def test_medium_details_expand_and_complete_prompts_keep_deepening(self):
        state=ideas.analyze('',medium='Novel')
        self.assertGreaterEqual(len(state['details']),20)
        screenplay={d['id'] for d in ideas.analyze('',medium='Screenplay')['details']}
        comic={d['id'] for d in ideas.analyze('',medium='Comic script')['details']}
        self.assertIn('runtime',screenplay);self.assertIn('panels',comic);self.assertNotIn('panels',screenplay)
        text='\n'.join(d['label']+': concrete author detail' for d in state['details'])
        complete=ideas.analyze(text)
        self.assertTrue(all(d['status']=='provided' for d in complete['details']))
        slots=ideas.targets(complete)
        self.assertTrue(slots);self.assertTrue(all(s['deepen'] and s['action']=='append' for s in slots))
        self.assertEqual(ideas.targets(complete,False),[])

    def test_documentary_asks_for_sources_instead_of_magic(self):
        state=ideas.analyze('',medium='Documentary')
        labels={d['label'] for d in state['details']}
        self.assertIn('Research and sources',labels);self.assertIn('Factual context',labels);self.assertNotIn('World rules',labels)
        self.assertIn('Never fabricate',contract({'medium':'Documentary'})['format'])

    def test_revision_scope_only_changes_unique_source_span(self):
        text='Before.\nMara   keeps the key.\nAfter.'
        cfg=creative_studio.validate({'operation':'revise','text':text,'target_passage':'Mara keeps the key.'})
        self.assertEqual(cfg['target_passage'],'Mara   keeps the key.')
        self.assertEqual(text.replace(cfg['target_passage'],'She hands it back.',1),'Before.\nShe hands it back.\nAfter.')
        with self.assertRaisesRegex(ValueError,'more than once'):
            creative_studio.validate({'operation':'revise','text':'same\nsame','target_passage':'same'})
        self.assertEqual(creative_studio.validate({'operation':'review','text':text,'target_passage':'outdated quote'})['target_passage'],'')

    def test_format_and_pacing_contracts_reach_the_actual_writer(self):
        captured=[]
        def complete(provider,model,messages,*args,**kw):
            captured.append(messages)
            return {'choices':[{'finish_reason':'stop','message':{'content':json.dumps({'title':'Scene 1','text':'INT. TEMPLE - DAY\n\nMARA\nStay here.'})}}]}
        with tempfile.TemporaryDirectory() as root,patch.object(creative_studio.creative_stream,'configuration',return_value=('test','test')),patch.object(creative_studio.creative_stream,'completion',side_effect=complete):
            creative_studio.run(Path(root),{'operation':'draft','brief':'A family in Egypt','medium':'Screenplay','pacing':'deliberate','use_story':False},stream=True)
        system=captured[0][0]['content']
        self.assertIn('INT./EXT.',system);self.assertIn('ONE major plot turn',system)
        self.assertEqual(json.loads(captured[0][-1]['content'])['medium_contract']['medium'],'screenplay')


    def test_flattened_screenplays_are_rejected_and_prep_weekends_move_earlier(self):
        with self.assertRaisesRegex(ValueError,'separate lines'):
            validate_presentation('INT. TEMPLE - DAY. Mara walks. MARA Come here.','Screenplay')
        validate_presentation('INT. TEMPLE - DAY\nMARA\nCome here.','Screenplay')
        cfg=production.normalize_config({'start_date':'2026-12-07','skip_weekends':True})
        value={'tasks':[{'id':'costume','task':'Fit costumes','owner':'Art','anchor':'first_shoot','offset_days':-2,'duration_hours':4,'dependencies':[]}],'constraints_conflicts':['None identified']}
        schedule_tasks(value,cfg,production.schedule([scene()],cfg))
        self.assertEqual(value['tasks'][0]['start'][:10],'2026-12-04')
        self.assertEqual(value['constraints_conflicts'],[])

    def test_music_payload_has_exact_direction_stable_seed_and_no_story_prose(self):
        cue={'mode':'song','author_direction':'A quiet folk song with a solo guitar. No drums.','prompt':'Mara fights a dragon in Egypt.'}
        a=music_payload(cue,'minimax-music3',30,'[Verse]\nA light at home')
        b=music_payload(cue,'minimax-music3',30,'[Verse]\nA light at home')
        self.assertEqual(a,b);self.assertIn(cue['author_direction'],a['prompt']);self.assertNotIn('dragon',a['prompt'])
        self.assertNotEqual(a['seed'],music_payload(cue,'minimax-music3',60,a['lyrics'])['seed'])

    def test_department_tasks_and_resource_budget_have_consistent_quantities(self):
        cfg=production.normalize_config({'region':'Ouarzazate, Morocco','start_date':'2026-12-07','timezone':'Africa/Casablanca'})
        timing=production.schedule([scene(minutes=500),scene('s2',minutes=500)],cfg)
        model=Mock();model.ask.return_value=operations()
        result=develop_operations(model,breakdown(),cfg,timing,lambda _:None)
        self.assertEqual(len(result['departments']),18)
        tasks=result['tasks']
        for a,b in zip(tasks,tasks[1:]):
            if a['start'][:10]==b['start'][:10]:self.assertLessEqual(a['end'],b['start'])
        data=breakdown();reconcile_resources(data,result,cfg,timing)
        crew=next(r for r in data['budget_items'] if r['category']=='crew')
        self.assertEqual(crew['quantity'],2*(timing['shoot_days']+1))
        plan={'title':'Film','created_at':'2026-10-25T12:00:00+00:00','schedule':timing,'operations':result,'recommendations':{'legal_logistics':[]}}
        self.assertEqual(calendar_ics(plan).count(b'BEGIN:VEVENT'),len(timing['events'])+18)
        self.assertIn(b'Approved',export(plan,'tasks.csv')[0])

    def test_department_cycle_and_missing_scope_are_repaired_not_accepted(self):
        cfg=production.normalize_config({'start_date':'2026-12-07'})
        model=Mock();bad=operations();bad['departments'][0]['tasks'][0]['dependencies']=['t0'];model.ask.side_effect=[bad,operations()]
        result=develop_operations(model,breakdown(),cfg,production.schedule([scene()],cfg),lambda _:None)
        self.assertEqual(model.ask.call_count,2);self.assertEqual(len(result['tasks']),18)

    def test_only_evidence_with_matching_currency_unit_and_amount_updates_rates(self):
        model=Mock();data=breakdown();cfg=production.normalize_config({'region':'Morocco'})
        data['budget_items'][0].update(category='equipment',description='Camera hire')
        evidence=[{'id':'R1','snippet':'Camera hire is USD 100 per day.','url':'https://example.com/rates'}]
        good={'rates':[{'item_index':0,'low_rate':100,'high_rate':100,'currency':'USD','unit':'day','quote':evidence[0]['snippet'],'source_ids':['R1']}]}
        bad=copy.deepcopy(good);bad['rates'][0]['low_rate']=1
        model.ask.side_effect=[bad,good]
        apply_price_evidence(model,data,cfg,evidence,lambda _:None)
        self.assertEqual(data['budget_items'][0]['low_rate'],100)
        self.assertEqual(model.ask.call_count,2)

    def test_hotels_maps_flights_use_separate_cached_engines_and_dated_prices(self):
        with tempfile.TemporaryDirectory() as root:
            search=Search(root,keys=['private-key'],plan_limit=8)
            hotel={'properties':[{'name':'Crew hotel','rate_per_night':{'extracted_lowest':70},'link':'https://example.com/hotel'}]}
            params={'check_in_date':'2026-12-01','check_out_date':'2026-12-04','adults':2,'currency':'USD'}
            with patch('paramyth.pipeline.production_research.request_json',return_value=hotel) as call:
                first=search.search('Ouarzazate','hotels',engine='google_hotels',parameters=params)
                self.assertEqual(first['results'][0]['rate'],70)
                self.assertEqual(first['results'][0]['rate_unit'],'room-night')
                self.assertIn('engine=google_hotels',call.call_args.args[0])
                self.assertTrue(search.search('Ouarzazate','hotels',engine='google_hotels',parameters=params)['cached'])
                search.search('Ouarzazate','hotels',engine='google_hotels',parameters={**params,'check_out_date':'2026-12-05'})
                self.assertEqual(call.call_count,2)
            self.assertNotIn(b'private-key',search.db.read_bytes())

    def test_no_flight_search_without_origin_and_hotel_room_nights_add_up(self):
        cfg=production.normalize_config({'region':'Ouarzazate','start_date':'2026-12-07','crew_size':6,'search_limit':8})
        search=Mock();search.search.return_value={'results':[],'retrieved_at':1,'evidence_level':'structured_search_result'}
        data=breakdown();timing=production.schedule(data['scenes'],cfg)
        result=research_logistics(search,cfg,timing,[],[],[],data,{},lambda _:None)
        self.assertEqual(result['rooms'],3)
        self.assertEqual(next(r for r in data['budget_items'] if r['description']=='Crew accommodation')['quantity'],3*result['nights'])
        self.assertFalse(any(c.kwargs.get('engine')=='google_flights' for c in search.search.call_args_list))
        self.assertTrue(any('departure airport' in m for m in result['missing']))


    def test_production_edits_and_exports_stay_on_the_updated_server(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from paramyth.pipeline.api.studio_bridge import StudioBridge
        app=FastAPI();app.add_middleware(StudioBridge)
        @app.get('/api/config')
        def config():return {'local':True}
        @app.get('/export/{plan}/{kind}')
        def download(plan:str,kind:str):return {'local':True}
        with patch.dict('os.environ',{'PARAMYTH_SERVICE_ORIGIN':'http://127.0.0.1:1'}),TestClient(app) as client:
            self.assertEqual(client.get('/api/config').json(),{'local':True})
            self.assertEqual(client.get('/export/plan/calendar.ics').json(),{'local':True})

    def test_downloads_use_visible_edits_and_format_specific_structure(self):
        with tempfile.TemporaryDirectory() as root:
            root=Path(root)
            save(root/'author-workspace.json',{'title':'The Temple','brief':{'medium':'Screenplay'},'scenes':[{'id':'a','chapter':1,'title':'Arrival','content':'Outdated text'}]})
            text='INT. TEMPLE - DAY\n\nMARA\nKeep the lamp.\n\nEli waits by the door.'
            save(root/'workspace-drafts.json',{'writing.edits':{'a':{'base':'manuscript','title':'At the temple','text':text}}})
            doc,mime,name=export_writing(root,'docx','a')
            with zipfile.ZipFile(io.BytesIO(doc)) as z:
                xml=z.read('word/document.xml').decode();self.assertIn('Keep the lamp.',xml);self.assertNotIn('Outdated',xml)
                self.assertIn('w:left="3168"',xml)
            fountain=export_writing(root,'fountain')[0].decode()
            self.assertIn('Title: The Temple',fountain);self.assertIn('INT. TEMPLE - DAY',fountain)
            from pypdf import PdfReader
            pdf=PdfReader(io.BytesIO(export_writing(root,'pdf')[0]))
            self.assertIn('Keep the lamp.',''.join(p.extract_text() for p in pdf.pages))


if __name__=='__main__':unittest.main()
