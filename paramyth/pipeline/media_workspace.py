"""Project-scoped inputs for imagery, soundtrack direction and production."""
import hashlib
import json
import os
import re
import secrets
import time
from pathlib import Path
from urllib.request import Request, urlopen
from .storage import load, save
from .soundtracks import context, plan as sound_plan, Vultr, wav_stream
from .production import Muse
from . import image_studio

NATURAL_FINISH = "Observe a specific lived-in moment. Use distinct faces, subtle asymmetry, unposed gestures, plausible anatomy and weight, motivated light, restrained highlights, worn materials and believable spatial relationships. Avoid waxy skin, identical faces, excessive glow and oversharpening. Preserve the requested medium; for illustration use intentional brushwork or paper texture rather than forcing photography."


def writing_output(value):
    if value.get('status')=='complete':return value.get('result',{})
    preview=value.get('preview',{})
    if preview.get('stage') in ('Draft','Revise'):return preview
    return next((s['output'] for s in reversed(value.get('steps',[])) if s.get('stage') in ('Draft','Revise') and s.get('output',{}).get('text')), {})


def writings(folder, include_live=False):
    values=[]
    for path in (Path(folder)/'creative').glob('*.json'):
        value=load(path)
        output=writing_output(value)
        if (value.get('status')=='complete' or include_live) and value.get('request',{}).get('operation')!='review' and isinstance(output.get('text'),str) and output['text'].strip():values.append(value)
    return sorted(values,key=lambda v:v.get('created_at',''),reverse=True)


def material(folder, source='latest', manual='', use_story=True):
    if not isinstance(manual,str) or len(manual)>20000:raise ValueError('Keep the brief under 20,000 characters')
    follow_latest=source=='latest'
    rows=writings(folder,True);sources=[];title='Your brief';selected='manual';status='complete'
    display_text=None
    drafts=load(Path(folder)/'workspace-drafts.json') if (Path(folder)/'workspace-drafts.json').is_file() else {}
    if use_story:
        if source=='latest' and drafts.get('writing.chapter'):source='active'
        elif source=='latest' and rows:source=rows[0]['id']
        if source=='active' or source.startswith('chapter:'):
            from .creative_studio import chapter_context,scene_output
            author=load(Path(folder)/'author-workspace.json') if (Path(folder)/'author-workspace.json').is_file() else {}
            chapter=drafts.get('writing.chapter',1);scene_id=drafts.get('writing.sceneIds',{}).get(str(chapter))
            if source.startswith('chapter:'):
                scene_id=source.removeprefix('chapter:')
                match=next((s for s in author.get('scenes',[]) if s['id']==scene_id),None)
                if match is None:raise ValueError('Choose a chapter from this project')
                chapter=match['chapter']
            scenes=[s for s in author.get('scenes',[]) if s['chapter']==chapter]
            scene=next((s for s in scenes if s['id']==scene_id),scenes[0] if scenes else {'id':f'chapter-{chapter}','chapter':chapter,'title':f'Chapter {chapter}','content':''})
            output=scene_output(Path(folder),scene,drafts,live=True)
            selected=output['source_id'];title=output['title'];status=output['status'];display_text=output['text']
            sources=chapter_context(Path(folder),chapter,scene['id'])
            if display_text.strip():sources.append({'file':f'Current chapter: {title}','text':display_text})
            else:
                key='creative.input' if chapter==1 else f'creative.chapter{chapter}.input'
                display_text=drafts.get(key,'')
                if display_text.strip():sources.append({'file':f'Chapter {chapter} idea','text':display_text})
        elif source=='working':
            drafts=load(Path(folder)/'workspace-drafts.json') if (Path(folder)/'workspace-drafts.json').is_file() else {}
            chapter=drafts.get('writing.chapter',1)
            text=drafts.get('creative.input' if chapter==1 else f'creative.chapter{chapter}.input','')
            if not isinstance(text,str) or not text.strip():raise ValueError('Add text in Ideas & writing first')
            sources=[{'file':'Current editor text','text':text}];selected='working';title='Current editor text'
        elif source in ('latest','manuscript'):
            sources=context(folder);selected='manuscript';title='Current manuscript'
        else:
            record=next((v for v in rows if v['id']==source),None)
            if record is None:raise ValueError('Choose writing from this project')
            output=writing_output(record);selected=record['id'];status=record['status']
            if follow_latest and status=='complete':
                drafts_path=Path(folder)/'workspace-drafts.json'
                drafts=load(drafts_path) if drafts_path.is_file() else {}
                edited=drafts.get('writing.edits',{}).get(record.get('request',{}).get('scene_id'),{})
                if edited.get('base')==selected and isinstance(edited.get('text'),str):output={**output,**edited}
            title=output.get('title') or 'Generated writing'
            sources=[{'file':'creative/'+selected+'.txt','text':output['text']}]
            if record.get('request',{}).get('chapter'):
                from .creative_studio import chapter_context
                cfg=record['request']
                sources=chapter_context(Path(folder),cfg['chapter'],cfg.get('scene_id',''))+sources
            if output.get('completed_brief'):sources.append({'file':'creative/'+selected+'.json','text':json.dumps(output['completed_brief'],ensure_ascii=False)})
    writing_signature=hashlib.sha256(json.dumps(sources,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    if manual.strip():sources.append({'file':'Your instructions','text':manual.strip()})
    if not sources:raise ValueError('Choose story writing or enter your own brief')
    signature=hashlib.sha256(json.dumps(sources,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    return {'source_id':selected,'title':title,'signature':signature,'writing_signature':writing_signature,'sources':sources,'status':status,'display_text':display_text}


def catalog(folder, source='latest'):
    rows=writings(folder,True)
    images=[i for i in image_studio.gallery(folder) if i['status']=='completed']
    tracks=[]
    for path in sorted((Path(folder)/'soundtracks').glob('*.json'),key=lambda p:p.stat().st_mtime,reverse=True):
        value=load(path)
        if value.get('job',{}).get('status')=='completed':
            tracks.append({'id':path.stem,'title':value.get('source_title') or value.get('cue',{}).get('mode','Soundtrack'),'mode':value.get('cue',{}).get('mode','')})
    current=None
    try:
        selected=material(folder,source)
        text=selected['display_text'] if selected.get('display_text') is not None else '\n\n'.join(s['text'] for s in selected['sources'])
        current={k:selected[k] for k in ('source_id','title','signature','status')}
        current.update(excerpt=text,words=len(text.split()))
    except ValueError:pass
    return {'writing':[{'id':v['id'],'title':writing_output(v).get('title') or 'Generated writing','status':v['status']} for v in rows], 'images':images,'tracks':tracks,'current':current}


def music_settings(folder, data, models, *, selected=None):
    selected=selected or material(folder,data.get('source','latest'),str(data.get('prompt','')),data.get('use_story',True))
    auto=data.get('automatic',True)
    if auto:
        value=Muse().ask('Design one soundtrack for the supplied writing and author prompt. Choose score, song (only when singing is requested), or ambience. Return JSON with mode, seconds (integer, 5–360), prompt (a specific musical or environmental direction under 700 characters), lyrics (only for a song), model (choose from supplied available models). Choose all missing settings. Do not include unrelated story details.',{'story_sources':selected['sources'],'models':models})
    else:value={k:data.get(k) for k in ('mode','seconds','model','lyrics')};value['prompt']=data.get('prompt','')
    mode=value.get('mode','score')
    if mode not in ('score','song','ambience'):raise ValueError('Choose a soundtrack type')
    spec=next((m for m in models if m['id']==value.get('model')),models[0] if models else None)
    if mode!='ambience' and not spec:raise ValueError('Connect a music provider or choose Ambient soundscape in Sound settings')
    limits=(spec or {}).get('duration',{}) if mode!='ambience' else {}
    seconds=max(int(limits.get('min',5)),min(int(limits.get('max',360)),int(value.get('seconds') or 60)))
    cue=sound_plan(folder,mode,str(value.get('prompt',''))[:700],sources=selected['sources'])
    return {'mode':mode,'seconds':seconds,'model':spec['id'] if spec else '', 'lyrics':str(value.get('lyrics') or '')[:12000], 'prompt':str(value.get('prompt') or '')[:700], 'cue':cue,'source':selected}


def service_json(path, data=None, project_id=None):
    from .api.studio_bridge import loopback
    base=loopback('PARAMYTH_SERVICE_ORIGIN')
    if not base:raise ValueError('Connect the music provider in Connections')
    headers={'Content-Type':'application/json'}
    if project_id:headers['Cookie']='pm_pipeline_project='+project_id
    if data is not None:
        with urlopen(base+'/ideas',timeout=15) as page:html=page.read().decode()
        token=re.search(r"const CSRF='([A-Za-z0-9_-]+)'",html)
        if not token:raise ValueError('Refresh the connected studio before trying again')
        headers['X-ParaMyth-Token']=token[1]
    request=Request(base+path,data=json.dumps(data).encode() if data is not None else None,headers=headers)
    with urlopen(request,timeout=60) as response:return json.load(response)


def music_models():
    if os.getenv('VULTR_INFERENCE_API_KEY'):return Vultr().json('/music/models')['data']
    if os.getenv('PARAMYTH_SERVICE_ORIGIN'):return service_json('/api/studio/music/models').get('data',[])
    return []


def create_music(folder, data, progress, *, selected=None):
    folder=Path(folder);progress('Choosing sound and settings')
    models=music_models() if data.get('automatic',True) or data.get('mode')!='ambience' else []
    settings=music_settings(folder,data,models,selected=selected);cue=settings['cue'];seconds=settings['seconds']
    if settings['mode']=='ambience':
        ident='local_'+secrets.token_hex(12);target=folder/'soundtracks'/(ident+'.wav');target.parent.mkdir(parents=True,exist_ok=True)
        progress('Rendering your soundscape')
        with target.open('wb') as out:
            for block in wav_stream(cue,seconds):out.write(block)
        value={'cue':cue,'provider':'local procedural','job':{'id':ident,'status':'completed'},'file':target.name}
    elif os.getenv('VULTR_INFERENCE_API_KEY'):
        progress('Sending your soundtrack to the music provider')
        job=Vultr().create(cue,settings['model'],seconds,settings['lyrics']);ident=job['id']
        value={'cue':cue,'provider':'Vultr Serverless Inference','job':job}
    else:
        # The older connected studio reads files instead of accepting a cue.
        # Give it an immutable input snapshot, never the unrelated original run.
        snapshot=folder/'.media-inputs'/secrets.token_hex(12)
        save(snapshot/'story.txt','\n\n'.join(s['text'] for s in settings['source']['sources']))
        pid=hashlib.sha256(str(snapshot.resolve()).encode()).hexdigest()[:16]
        remote=service_json('/api/studio/music',{k:settings[k] for k in ('mode','seconds','model','lyrics')} | {'direction':settings['prompt']},pid)
        save(snapshot/'submission.json',remote)
        progress('The connected music provider is preparing your soundtrack')
        deadline=time.monotonic()+180
        while time.monotonic()<deadline:
            job=service_json('/api/job/'+remote['job_id'])
            if job['status']=='complete':break
            if job['status'] in ('failed','interrupted','cancelled'):raise ValueError(job.get('message','Music request failed'))
            time.sleep(1)
        else:raise ValueError('The music request is still pending in the connected studio. Do not submit it again yet.')
        value=job['result'];ident=value['job']['id'];value['cue']=cue
    value.update(settings={k:settings[k] for k in ('mode','seconds','model','lyrics','prompt')},source_id=settings['source']['source_id'],source_title=settings['source']['title'],source_signature=settings['source']['signature'],writing_signature=settings['source']['writing_signature'])
    save(folder/'soundtracks'/(ident+'.json'),value)
    return value
