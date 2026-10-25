"""Author workspace adapter: real project files, persisted edits and corpus search."""
from copy import deepcopy
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import re
import os
import asyncio
from fastapi.responses import StreamingResponse
from fastapi import APIRouter,Body,Depends,HTTPException,Request,Response
from .studio_routes import get_runtime,local,write,folder
from .studio_runtime import now
from ..storage import load,save
from .atlas import load_stories

router=APIRouter(prefix='/api/ui',tags=['ParaMyth workspace'],dependencies=[Depends(local)])
RT=Depends(get_runtime)
MEDIA={'book':'Novel','novel':'Novel','short_story':'Short story','stage_play':'Stage play','screenplay':'Screenplay','audio_drama':'Audio drama','comic_script':'Comic script'}

def read(path,default):
    try:return load(path) if path.is_file() else default
    except (ValueError,OSError):return default

def revision(path):return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else 'new'


def review_findings(scene):
    result=[]
    for key,dimension in [('review','Story'),('rhetoric_review','Rhetoric'),('memory_review','Memory')]:
        review=scene.get(key,{})
        if not isinstance(review,dict):continue
        for i,issue in enumerate(review.get('issues',[])):
            if not isinstance(issue,dict):continue
            result.append({'id':key+'-'+str(i),'dimension':dimension,'severity':'Blocking' if issue.get('severity')=='blocking' else 'Minor',
                           'quote':str(issue.get('quote','')),'note':str(issue.get('problem',''))+' '+str(issue.get('fix','')),
                           'status':'Open','source':'Reviewer'})
    return result


def canon_facts(state,editorial):
    canon=state.get('canon',{});canon=canon if isinstance(canon,dict) else {}
    rows=canon.get('facts',state.get('facts',[]));rows=rows if isinstance(rows,list) else []
    result=[]
    for i,f in enumerate(rows):
        if not isinstance(f,dict):continue
        kind=str(f.get('kind','event')).capitalize()
        result.append({'id':str(f.get('id','fact-'+str(i))),'kind':kind if kind in ('Event','Belief','Claim','Resource','Relationship','Thread') else 'Event',
                       'text':str(f.get('text',f.get('content',''))),'holders':f.get('known_by',['Public']),
                       'sceneId':str(f.get('scene_id',f.get('source_scene',''))),'state':'Quarantined' if f.get('quarantined') else 'Provisional' if f.get('provisional') else 'Accepted'})
    if not result:
        for scene in editorial.get('scenes',[]):
            for key,value in scene.get('facts',{}).items():
                result.append({'id':scene['id']+'-'+key,'kind':'Event','text':key.replace('_',' ')+': '+str(value),'holders':['Public'],'sceneId':scene['id'],'state':'Accepted'})
    return result

def project(runtime,ident):
    root=runtime.folder(ident);edited=root/'author-workspace.json'
    if edited.exists():
        p=load(edited);p['revision']=revision(edited);return p
    req=read(root/'request.json',{});state=read(root/'state.json',read(root/'canon'/'snapshot.json',{}))
    if state.get('backend')=='fixture':return None
    title=req.get('title') or root.name
    scenes=[]
    for i,s in enumerate(state.get('accepted',[])):
        if not isinstance(s,dict):continue
        text=s.get('prose',s.get('content',''))
        scenes.append({'id':s.get('id',f'scene-{i+1}'),'chapter':s.get('chapter',1),'title':s.get('title',s.get('id',f'Scene {i+1}')),'pov':s.get('pov',''),'location':s.get('location',''),'content':text,'state':'Provisional' if s.get('quality_status')=='needs_review' else 'Accepted','findings':review_findings(s),'minutes':max(1,len(text.split())//150),'night':False})
    if not scenes:
        source=next((root/n for n in ('FINAL_STORY.txt','PROVISIONAL_STORY.txt','PARTIAL_DRAFT.txt','story.txt') if (root/n).is_file()),None)
        if source:
            text=source.read_text(encoding='utf-8-sig')
            if text.startswith('FIXTURE /'):return None
            if not req:title=text.splitlines()[0][:150]
            scenes=[{'id':'manuscript','chapter':1,'title':'Manuscript','pov':'','location':'','content':text,'state':'Draft','findings':[],'minutes':max(1,len(text.split())//150),'night':False}]
    chars=[]
    for i,c in enumerate(req.get('characters',[])):
        arc=c.get('arc',{})
        chars.append({'id':c.get('id',f'character-{i}'),'name':c.get('name',''),'goal':c.get('goal',''),'fear':c.get('fear',''),'voice':c.get('voice',''),'arc':{'belief':arc.get('starting_belief',''),'pressure':arc.get('pressure_test',''),'choice':arc.get('costly_choice',''),'change':arc.get('possible_change','')}})
    length=req.get('words_per_scene',{});length=length if isinstance(length,dict) else {'min':length,'max':length}
    brief={'premise':req.get('premise',''),'medium':MEDIA.get(req.get('medium'),'Novel'),'genre':str(req.get('genre','')),'tone':str(req.get('tone_mood','')),'pov':str(req.get('pov','')),'themes':req.get('theme_keywords',[]),'worldRules':req.get('world_rules',[]),'mustAvoid':req.get('must_avoid',[]),'chapters':req.get('chapters',1),'scenesPerChapter':req.get('scenes_per_chapter',1),'wordMin':length.get('min',600),'wordMax':length.get('max',1200),'lengthMode':'Guided','characters':chars}
    return {'id':ident,'title':title,'owner':'Your workspace','color':'mint','updated':datetime.fromtimestamp(root.stat().st_mtime,timezone.utc).isoformat(),'brief':brief,'scenes':scenes,'canon':canon_facts(state,read(root/'final-state.json',{})),'versions':[],'revision':'new','folder':str(root.relative_to(runtime.root)),'imported':True}

def export_request(p,previous):
    b=p['brief'];r=deepcopy(previous)
    r.update(title=p['title'],premise=b['premise'],medium=next((k for k,v in MEDIA.items() if v==b['medium']),'novel'),genre=b['genre'],tone_mood=b['tone'],pov=b['pov'],theme_keywords=b['themes'],world_rules=b['worldRules'],must_avoid=b['mustAvoid'],chapters=b['chapters'],scenes_per_chapter=b['scenesPerChapter'],words_per_scene=max(100,min(1600,round((b['wordMin']+b['wordMax'])/2))), min_words_ratio=b['wordMin']/max(100,min(1600,round((b['wordMin']+b['wordMax'])/2))),max_words_ratio=b['wordMax']/max(100,min(1600,round((b['wordMin']+b['wordMax'])/2))))
    r.setdefault('project_id',re.sub('[^A-Za-z0-9_-]','-',p.get('id') or p['title'])[:64] or 'story')
    original={c['id']:c for c in previous.get('characters',[]) if 'id' in c}
    r['characters']=[{**original.get(c['id'],{}),'id':c['id'],'name':c['name'],'goal':c['goal'],'fear':c['fear'],'voice':c['voice'],'arc':{**original.get(c['id'],{}).get('arc',{}),'starting_belief':c['arc']['belief'],'pressure_test':c['arc']['pressure'],'costly_choice':c['arc']['choice'],'possible_change':c['arc']['change']}} for c in b['characters']]
    return r

@router.get('/session')
def session(response:Response,runtime=RT):
    response.headers['Cache-Control']='no-store'
    return {'csrf':runtime.token,'mode':'live'}

@router.get('/workspace')
def workspace(request:Request,runtime=RT):
    items=[project(runtime,x['id']) for x in runtime.project_list()]
    items=[p for p in items if p is not None]
    current=getattr(runtime,'selected',None) or request.cookies.get('pm_pipeline_project')
    if current not in {p['id'] for p in items}:current=items[0]['id'] if items else ''
    meta=read(runtime.root/'runs'/'paramyth-workspace.json',{})
    return {'projects':items,'current':current,'ideas':meta.get('ideas',[]),'pins':meta.get('pins',[]),'drafts':{p['id']:read(runtime.folder(p['id'])/'workspace-drafts.json',{}) for p in items}}

@router.patch('/projects/{ident}/workspace',dependencies=[Depends(write)])
def save_workspace_drafts(ident:str,data:dict=Body(...),runtime=RT):
    # Field-level patches let independent workspace tabs save without replacing each other.
    if len(data)>150 or any(not re.fullmatch(r'[a-z][a-zA-Z0-9_.-]{0,79}',k) for k in data):
        raise ValueError('Invalid workspace field')
    if len(json.dumps(data,allow_nan=False))>2000000:raise ValueError('Workspace drafts are too large')
    target=runtime.folder(ident)/'workspace-drafts.json'
    with runtime.guard:
        current=read(target,{})
        updated={**current,**data}
        if len(json.dumps(updated,allow_nan=False))>4000000:raise ValueError('Workspace drafts are too large')
        save(target,updated)
    return {'saved':True}


@router.post('/creative',dependencies=[Depends(write)],status_code=202)
def stream_creative(request:Request,data:dict=Body(...),runtime=RT):
    from .. import creative_studio,creative_stream
    cfg=creative_studio.validate(data)
    creative_stream.configuration()
    current=folder(request,runtime)
    ident=runtime.submit('creative',current,lambda progress:creative_studio.run(current,cfg,progress,stream=True),streaming=True)
    return {'job_id':ident,'streaming':True}


@router.get('/creative')
def creative_records(request:Request,runtime=RT):
    paths=sorted((folder(request,runtime)/'creative').glob('*.json'),key=lambda p:p.stat().st_mtime,reverse=True)[:50]
    return {'results':[load(p) for p in paths]}


@router.get('/creative/jobs')
def creative_jobs(request:Request,runtime=RT):
    ident=runtime.project_id(folder(request,runtime))
    with runtime.guard:
        rows=[dict(j) for j in runtime.jobs.values() if j['project_id']==ident and j.get('streaming')]
    return {'jobs':sorted(rows,key=lambda j:j['created_at'],reverse=True)[:50]}


@router.get('/creative/jobs/{ident}')
def creative_job(ident:str,request:Request,runtime=RT):
    with runtime.guard:
        job=dict(runtime.job(ident))
    if job['project_id']!=runtime.project_id(folder(request,runtime)) or not job.get('streaming'):
        raise HTTPException(404,'Writing job not found in this project')
    return job


@router.get('/creative/jobs/{ident}/events')
async def creative_events(ident:str,request:Request,runtime=RT):
    creative_job(ident,request,runtime)
    async def stream():
        last=None;idle=0
        while not await request.is_disconnected():
            with runtime.guard:
                job=dict(runtime.job(ident))
            encoded=json.dumps(job,ensure_ascii=False)
            if encoded!=last:
                yield 'event: progress\ndata: '+encoded+'\n\n'
                last=encoded;idle=0
            elif idle>=150:
                yield ': keepalive\n\n';idle=0
            if job['status'] in ('complete','failed','interrupted','cancelled'):break
            idle+=1
            await asyncio.sleep(.1)
    return StreamingResponse(stream(),media_type='text/event-stream',headers={'Cache-Control':'no-cache','X-Accel-Buffering':'no'})


@router.get('/jobs')
def local_jobs(request:Request,runtime=RT):
    ident=runtime.project_id(folder(request,runtime))
    with runtime.guard:rows=[dict(j) for j in runtime.jobs.values() if j['project_id']==ident and (j.get('local') or j.get('streaming'))]
    return {'jobs':sorted(rows,key=lambda j:j['created_at'],reverse=True)[:100]}


@router.get('/jobs/{ident}')
def local_job(ident:str,request:Request,runtime=RT):
    with runtime.guard:job=dict(runtime.job(ident))
    if job['project_id']!=runtime.project_id(folder(request,runtime)):raise HTTPException(404,'Job not found in this project')
    return job


@router.get('/materials')
def materials(request:Request,runtime=RT):
    from ..media_workspace import catalog
    return catalog(folder(request,runtime),request.query_params.get('source','latest'))


@router.post('/images/prepare',dependencies=[Depends(write)],status_code=202)
def prepare_current_image(request:Request,data:dict=Body(...),runtime=RT):
    from .. import media_workspace,image_studio
    current=folder(request,runtime)
    selected=media_workspace.material(current,data.get('source','latest'),'',True)
    def operation(progress):
        result=image_studio.prepare_prompt(current,data,bool(data.get('enhance',True)),sources=selected['sources'])
        if data.get('natural_finish',True):result['prompt']=result['prompt'][:2900]+'\n'+media_workspace.NATURAL_FINISH
        return {**result,'source_id':selected['source_id'],'source_title':selected['title'],'source_signature':selected['signature']}
    return {'job_id':runtime.submit('image-prompt',current,operation,local=True),'local':True}


@router.post('/images/{ident}/source',dependencies=[Depends(write)])
def image_source(ident:str,request:Request,data:dict=Body(...),runtime=RT):
    from .. import image_studio,media_workspace
    current=folder(request,runtime);record=image_studio.read_record(current,ident)
    source=media_workspace.material(current,data.get('source','manuscript'))
    record['source_id']=source['source_id'];record['source_title']=source['title']
    save(image_studio.record_path(current,ident),record)
    return {'saved':True}


@router.post('/music',dependencies=[Depends(write)],status_code=202)
def current_music(request:Request,data:dict=Body(...),runtime=RT):
    from ..media_workspace import create_music,material
    current=folder(request,runtime)
    selected=material(current,data.get('source','latest'),str(data.get('prompt','')),data.get('use_story',True))
    return {'job_id':runtime.submit('music',current,lambda progress:create_music(current,data,progress,selected=selected),local=True),'local':True}


@router.post('/production',dependencies=[Depends(write)],status_code=202)
def current_production(request:Request,data:dict=Body(...),runtime=RT):
    import base64
    from .. import media_workspace,image_studio
    from ..production import create_plan,normalize_config
    current=folder(request,runtime)
    selected=media_workspace.material(current,data.get('source','latest'),data.get('prompt',''),data.get('use_story',True))
    cfg=normalize_config(data.get('config',{}))
    available=media_workspace.catalog(current) if data.get('automatic_assets') else None
    ids=[i['id'] for i in available['images'][:3]] if available else data.get('image_ids',[])
    if not isinstance(ids,list) or len(ids)>3 or any(not isinstance(i,str) for i in ids):raise ValueError('Choose up to three project images')
    images=[]
    for ident in ids:
        raw=image_studio.image_file(current,ident,0).read_bytes()
        if len(raw)>5*1024*1024:raise ValueError('Choose images under 5 MB')
        images.append({'mime':'image/png','data':base64.b64encode(raw).decode()})
    track_ids=[t['id'] for t in available['tracks'][:3]] if available else data.get('track_ids',[])
    if not isinstance(track_ids,list) or len(track_ids)>3 or any(not isinstance(i,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',i) for i in track_ids):raise ValueError('Choose up to three project soundtracks')
    for ident in track_ids:
        track=read(current/'soundtracks'/(ident+'.json'),{})
        if track.get('job',{}).get('status')!='completed':raise ValueError('Choose a completed soundtrack from this project')
        selected['sources'].append({'file':'soundtracks/'+ident+'.json','text':json.dumps({'cue':track.get('cue',{}),'settings':track.get('settings',{}),'note':'Selected soundtrack direction for production planning. Audio has not been transcribed or analyzed.'},ensure_ascii=False)})
    def operation(progress):
        result=create_plan(current,cfg,images,progress,sources=selected['sources'])
        result.update(source_id=selected['source_id'],source_title=selected['title'],source_signature=selected['signature'],writing_signature=selected['writing_signature'],image_ids=ids,track_ids=track_ids)
        save(current/'production'/'plans'/(result['id']+'.json'),result)
        return result
    return {'job_id':runtime.submit('production',current,operation,local=True),'local':True}


@router.post('/production/prepare',dependencies=[Depends(write)],status_code=202)
def prepare_production(request:Request,data:dict=Body(...),runtime=RT):
    from ..media_workspace import material
    from ..production import prepare_direction,normalize_config
    current=folder(request,runtime)
    selected=material(current,data.get('source','latest'),data.get('prompt',''),data.get('use_story',True))
    config=normalize_config(data.get('config',{}))
    def operation(progress):
        progress('Developing production direction from your writing')
        return {**prepare_direction(selected['sources'],config),'source_id':selected['source_id'],'source_signature':selected['signature']}
    return {'job_id':runtime.submit('production-brief',current,operation,local=True),'local':True}


@router.put('/notes',dependencies=[Depends(write)])
def notes(data:dict=Body(...),runtime=RT):
    if len(json.dumps(data))>1000000:raise ValueError('Notes are too large')
    save(runtime.root/'runs'/'paramyth-workspace.json',{'ideas':data.get('ideas',[]),'pins':data.get('pins',[])})
    return {'saved':True}

@router.put('/projects/{ident}',dependencies=[Depends(write)])
def update(ident:str,data:dict=Body(...),runtime=RT):
    from .author_schema import validate_project
    validate_project(data)
    root=runtime.folder(ident);target=root/'author-workspace.json'
    if len(json.dumps(data))>5000000:raise ValueError('Project exceeds 5 MB')
    if data.get('id')!=ident or not isinstance(data.get('brief'),dict) or not isinstance(data.get('scenes'),list):raise ValueError('Invalid project')
    with runtime.guard:
        if data.get('revision','new')!=revision(target):raise HTTPException(409,'This project changed elsewhere. Reload it before saving your changes.')
        old=read(root/'request.json',{})
        req=export_request(data,old)
        backup=root/'author-revisions'/(now().replace(':','-')+'.json')
        if target.exists():save(backup,load(target))
        elif old:save(root/'author-original-request.json',old)
        data={**data,'updated':now()};data.pop('revision',None)
        save(target,data);save(root/'request.json',req)
        # Generated accepted files/state remain intact; the author draft is an explicit source.
        draft='\n\n'.join(s.get('content','') for s in data['scenes'])
        save(root/'author-draft.txt',draft)
        if os.getenv('PARAMYTH_SERVICE_ORIGIN'):
            save(root/'scenes'/'author-current.txt','CURRENT AUTHOR DRAFT — supersedes earlier prose for new creative and media work.\n\n'+draft)
        return {**data,'revision':revision(target)}

@router.post('/projects',dependencies=[Depends(write)])
def create(data:dict=Body(...),runtime=RT):
    from .author_schema import validate_project
    p=data.get('project');validate_project(p)
    ident=runtime.create_project(p['title'],p['brief']['premise'] or ' ',export_request(p,{}))
    p={**p,'id':ident,'revision':'new'};saved=update(ident,p,runtime)
    return saved


@router.get('/projects/{ident}/request')
def runner_request(ident:str,runtime=RT):
    p=project(runtime,ident)
    if p is None:raise ValueError('Fixture projects cannot be used in the live studio')
    result=export_request(p,read(runtime.folder(ident)/'request.json',{}))
    meta=read(runtime.root/'runs'/'paramyth-workspace.json',{})
    references={r['record_id']:r for r in result.get('references',[]) if isinstance(r,dict) and 'record_id' in r}
    for pin in meta.get('pins',[]):
        if pin.get('projectId')==ident:
            references[pin['recordId']]={'record_id':pin['recordId'],'scope':'story','purpose':pin.get('purpose') or 'Literary inspiration'}
    result['references']=list(references.values())
    return result

@router.post('/search')
def search(data:dict=Body(...)):
    from ..retrieval import retrieve
    q=str(data.get('query','')).strip()
    if not 1<=len(q)<=2000:raise ValueError('Describe your idea in 1–2,000 characters')
    mode=data.get('mode','lexical')
    if mode not in ('lexical','hybrid'):raise ValueError('Choose keyword or semantic search')
    if mode=='hybrid':
        from paramyth.pipeline.rag.embeddings import api_key
        try:api_key()
        except RuntimeError:raise HTTPException(503,'Semantic search needs a Gemini embedding connection. Add it in Connections, or choose Story keywords.') from None
    limit=data.get('limit',8)
    if type(limit) is not int or not 1<=limit<=20:raise ValueError('Choose between 1 and 20 literary matches')
    stories=load_stories()[1];anchors={s.id:s.id for s in stories}
    for s in stories:
        for child in s.children:anchors[child.id]=s.id
    request={'premise':q,'retrieval_query':q,'characters':[],'keywords':[],'retrieval_mode':mode,'references':[]}
    # Idea search emphasizes meaning, while retaining a small exact-word signal.
    # Writer packets retain their existing source limits and scoring policy.
    if mode=='hybrid':request['retrieval_weights']={'semantic_similarity':.95,'keyword_match':.05,'narrative_mechanism_match':0}
    try:result=retrieve(request,source_limit=20 if mode=="hybrid" else limit,group_ids=anchors)
    except RuntimeError:raise HTTPException(503,'The literary search service is unavailable. Check the Gemini key in Connections and try again.') from None
    if mode=='hybrid':
        from paramyth.pipeline.rag.rerank import rerank
        try:
            result['sources']=rerank(q,result['sources'],limit)
            result['ranking']='Gemini relevance review'
        except RuntimeError:
            result['sources']=result['sources'][:limit]
            result['ranking_warning']='Relevance review is unavailable. Showing embedding and keyword matches; try again for closer matches.'
    return {**result,'sources':[{**s,'atlas_id':anchors.get(s['id'])} for s in result['sources']]}


@router.get('/retrieval-connection')
def retrieval_connection():
    from paramyth.pipeline.rag.embeddings import api_key
    try:api_key();configured=True
    except RuntimeError:configured=False
    return {'semantic':configured,'keyword':True}


@router.post('/retrieval-connection',dependencies=[Depends(write)])
def set_retrieval_connection(data:dict=Body(...)):
    key=data.get('key')
    if not isinstance(key,str) or not 10<=len(key.strip())<=500:raise ValueError('Enter the Gemini embedding API key')
    os.environ['GEMINI_API_KEY']=key.strip()
    return {'semantic':True,'keyword':True}


def _creative_author_project(value):
    """Adapt a saved model result without discarding its original decisions."""
    result=value.get('result')
    if value.get('status')!='complete' or not isinstance(result,dict):
        raise ValueError('Only a completed creative result can become a project')
    text=result.get('text')
    if not isinstance(text,str) or not text.strip():
        raise ValueError('This creative result has no idea or prose text to use')
    source=result.get('completed_brief',{})
    if not isinstance(source,dict):raise ValueError('The saved creative brief must be an object')
    def string(*keys,default=''):
        return next((source[k] for k in keys if isinstance(source.get(k),str)),default)
    def strings(*keys):
        item=next((source[k] for k in keys if k in source),[])
        return [item] if isinstance(item,str) and item else [s for s in item if isinstance(s,str)] if isinstance(item,list) else []
    def count(*keys,default):
        return next((source[k] for k in keys if type(source.get(k)) is int and source[k]>0),default)
    medium=string('medium',default='Novel')
    medium=MEDIA.get(medium.lower().replace(' ','_'),medium)
    if medium not in MEDIA.values():
        raise ValueError('Choose a supported medium in the creative brief before adopting it: '+', '.join(MEDIA.values()))
    cast=source.get('characters',[])
    if not isinstance(cast,list):raise ValueError('The creative brief character list is invalid')
    characters=[]
    for index,item in enumerate(cast):
        if isinstance(item,str):item={'name':item}
        if not isinstance(item,dict):raise ValueError('A creative character must have a name or character details')
        arc=item.get('arc',{});arc=arc if isinstance(arc,dict) else {}
        def char_text(key):return item[key] if isinstance(item.get(key),str) else ''
        def arc_text(key,legacy):return next((arc[k] for k in (key,legacy) if isinstance(arc.get(k),str)),'')
        characters.append({**deepcopy(item),'id':f'character-{index+1}','name':char_text('name'),'goal':char_text('goal'),'fear':char_text('fear'),'voice':char_text('voice'),
                           'arc':{'belief':arc_text('belief','starting_belief'),'pressure':arc_text('pressure','pressure_test'),'choice':arc_text('choice','costly_choice'),'change':arc_text('change','possible_change')}})
    length=source.get('words_per_scene',{})
    length=length if isinstance(length,dict) else {'min':length,'max':length} if type(length) is int else {}
    word_min=count('wordMin',default=length.get('min',600));word_max=count('wordMax',default=length.get('max',1200))
    if type(word_min) is not int or word_min<1:word_min=600
    if type(word_max) is not int or word_max<word_min:word_max=max(word_min,1200)
    brief={**deepcopy(source),'premise':string('premise',default=text),'medium':medium,'genre':string('genre'),
           'tone':string('tone','tone_mood'),'pov':string('pov'),'themes':strings('themes','theme_keywords'),
           'worldRules':strings('worldRules','world_rules'),'mustAvoid':strings('mustAvoid','must_avoid'),
           'chapters':count('chapters',default=1),'scenesPerChapter':count('scenesPerChapter','scenes_per_chapter',default=1),
           'wordMin':word_min,'wordMax':word_max,'lengthMode':'Guided','characters':characters}
    title=result.get('title');title=title.strip()[:150] if isinstance(title,str) and title.strip() else 'Creative idea'
    return {'id':'','title':title,'owner':'Your workspace','color':'mint','updated':now(),'brief':brief,
            'scenes':[{'id':'creative-draft','chapter':1,'title':'Developed idea' if value.get('request',{}).get('operation')=='ideas' else 'Creative draft',
                       'pov':'','location':'','content':text,'state':'Draft','findings':[],'minutes':max(1,len(text.split())//150),'night':False}],
            'canon':[],'versions':[]}


@router.post('/creative/{ident}/use-as-project',dependencies=[Depends(write)])
def adopt_creative_project(ident:str,request:Request,data:dict=Body(default={}),runtime=RT):
    if not re.fullmatch('[a-f0-9]{24}',ident):raise ValueError('Invalid creative output ID')
    source=folder(request,runtime)
    value=load(source/'creative'/(ident+'.json'))
    if 'text' in data:
        if not isinstance(data['text'],str) or not 1<=len(data['text'])<=60000:raise ValueError('Keep the developed idea between 1 and 60,000 characters')
        value=deepcopy(value);value.setdefault('result',{})['text']=data['text']
    p=_creative_author_project(value)
    original=deepcopy(value['result'].get('completed_brief',{}))
    provenance={'source_project_id':runtime.project_id(source),'creative_result_id':ident,'completed_brief':original,
                'assumptions':deepcopy(value['result'].get('assumptions',[])),'suggestions':deepcopy(value['result'].get('suggestions',[]))}
    p['creative_source']=provenance
    # Keep structure, stakes, ending and any additional authored fields for runners.
    req=export_request(p,{**original,'characters':p['brief']['characters']});req['creative_source']=provenance
    created=runtime.create_project(p['title'],value['result']['text'],req)
    p.update(id=created,revision='new')
    saved=update(created,p,runtime)
    save(runtime.folder(created)/'creative-source.json',value)
    # The client selects the new project only if the user has not switched away.
    return {'id':created,'project':saved}
