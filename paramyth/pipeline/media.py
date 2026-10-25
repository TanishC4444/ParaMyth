"""Fast application-owned medium selection; no prompt-refinement model call."""
import re

PROFILES={
 'book':{'label':'novel','script':False,'format':'Developed prose with viewpoint, interiority, sensory detail and chapter progression. Dialogue follows the author brief.'},
 'short_story':{'label':'short story','script':False,'format':'Concentrated prose scenes with a consequential arc; avoid padding and novel-scale exposition.'},
 'stage_play':{'label':'stage play','script':True,'format':'A performable theatre script: ACT/SCENE heading at the scene opening, concise stage directions, character names as speaker cues and playable dialogue. Show thoughts through speech, silence and physical behavior; no novel-style omniscient interiority. Respect staging and entrances/exits.'},
 'screenplay':{'label':'screenplay','script':True,'format':'Screenplay format: INT./EXT. scene heading, present-tense visible action, uppercase character cues and dialogue. No unfilmable internal narration or unsolicited camera-shot list.'},
 'audio_drama':{'label':'audio drama','script':True,'format':'Audio script: scene label, character cues, dialogue and purposeful SOUND/MUSIC cues. Establish space and action audibly; do not rely on unseen gestures or prose narration unless an authorized narrator exists.'},
 'comic_script':{'label':'comic script','script':True,'format':'Comic script: numbered PAGE/PANEL blocks, concise drawable action, character dialogue and captions where appropriate. Maintain panel order, visual continuity and readable speech volume.'},
 'documentary':{'label':'documentary script','script':True,'format':'Documentary script in numbered sequences with VIDEO and AUDIO columns or clearly labelled VIDEO:/AUDIO: blocks. Distinguish interview questions, proposed B-roll, archival research and narration. Never fabricate factual claims, quotations, testimony or source citations. Mark unsupported facts [RESEARCH NEEDED] and proposed interviews [INTERVIEW PROPOSAL]. No fictional novel-style interiority.'},
 'television':{'label':'television episode script','script':True,'format':'Television script with TEASER/ACT headings as appropriate, INT./EXT. sluglines, present-tense visible action, uppercase speaker cues and dialogue. Build an episode turn while preserving series threads. No novel-style interior narration.'}
}
ALIASES={'novel':'book','novella':'book','prose':'short_story','prose fiction':'short_story','short story':'short_story','shortstory':'short_story','play':'stage_play','theater':'stage_play','theatre':'stage_play','theater play':'stage_play','theatre play':'stage_play','stage play':'stage_play','script':'stage_play','film':'screenplay','film script':'screenplay','movie script':'screenplay','audio drama':'audio_drama','radio play':'audio_drama','comic':'comic_script','comic script':'comic_script','graphic novel':'comic_script'}
ALIASES.update({'documentary script':'documentary','documentary film':'documentary','tv':'television','tv episode':'television','television script':'television'})


def choose(req,require):
    supplied=req.get('medium','auto');raw=str(supplied).strip().lower();canonical=ALIASES.get(raw,raw)
    method='explicit_medium'
    if raw in {'auto',''}:
        prompt=req.get('premise','').lower();method='prompt_medium_detection'
        rules=[('screenplay',r'\b(screenplay|film script|movie script)\b'),('audio_drama',r'\b(audio drama|radio play|audio script)\b'),('comic_script',r'\b(comic script|graphic novel|comic book)\b'),('stage_play',r'\b(stage play|theat(?:er|re)(?: play| script)?|play script)\b'),('book',r'\b(novel|novella)\b')]
        canonical=next((name for name,pattern in rules if re.search(pattern,prompt)),'short_story')
    require(canonical in PROFILES,'Unsupported medium; use book, short_story, stage_play, screenplay, audio_drama or comic_script')
    req['medium']=canonical
    req.setdefault('medium_decision',{'method':method,'selected':canonical,'model_calls':0})
    return req


def contract(req):
    raw=str(req.get('medium','short_story')).lower()
    medium=ALIASES.get(raw,raw)
    profile=PROFILES.get(medium,PROFILES['short_story'])
    return {'medium':medium,**profile,'precedence':'The chosen medium governs presentation. Explicit author constraints still govern content; a deliberately silent script remains a script.'}


def instructions(req):
    spec=contract(req)
    return 'MEDIUM CONTRACT: '+spec['label']+'. '+spec['format']+' Only the first writing batch supplies the scene heading; later batches continue without repeating headings or earlier action. Use the requested scene/act/chapter numbering.'


def validate_presentation(text,medium):
    """Reject flattened scripts so format requests cannot silently become prose."""
    spec=contract({'medium':medium})
    if not spec['script']:return
    lines=[line.strip() for line in text.splitlines() if line.strip()]
    name=spec['medium']
    if len(lines)<3:raise ValueError('Script format needs separate lines for headings, action, speaker cues and dialogue. Put escaped newline characters in the JSON text string; never flatten the script into a paragraph.')
    if name in ('screenplay','television') and not any(re.match(r'^(?:INT\.|EXT\.|INT\./EXT\.|I/E\.)',line) and len(line)<180 for line in lines):raise ValueError('Movie/TV scripts need an INT./EXT. slugline on its own line, separate action paragraphs, uppercase speaker cues on their own lines, then dialogue.')
    if name in ('screenplay','television','stage_play','audio_drama') and not any(line.isupper() and len(line)<60 and not line.startswith(('INT.','EXT.','ACT ','SCENE ')) for line in lines):raise ValueError('Put each character speaker cue on its own uppercase line, with dialogue on following lines. A silent work can use separate SOUND or ACTION cues.')
    if name=='comic_script' and not any(re.match(r'^(?:PAGE|PANEL)\s+\d',line,re.I) for line in lines):raise ValueError('Comic scripts need numbered PAGE/PANEL blocks on separate lines.')
    if name=='documentary' and not all(any(re.match(label+r'\s*:',line,re.I) for line in lines) for label in ('VIDEO','AUDIO')):raise ValueError('Documentaries need separate VIDEO: and AUDIO: blocks with research/interview placeholders where facts are unverified.')
