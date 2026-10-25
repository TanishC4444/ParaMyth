"""Rule-based brief coverage and constrained, opt-in prompt suggestions.

Coverage reports evidence recognized by these rules, not an LLM's opinion of
completeness. Only explicit help lines authorize replacement; model output can
never choose an edit's scope or change the author's original prompt.
"""
import hashlib
import re

RULE_VERSION = 2
# id, display label, explicit labels/help topics, evidence in ordinary language
RULES = (
    ('characters', 'Characters', r'characters?|protagonist|hero(?:ine)?|cast', r'\b(?:a|an|the)\s+(?:(?:young|old|lonely|retired|brave)\s+)?(?:girl|boy|woman|man|child|keeper|witch|knight|prince|princess|detective|sailor|librarian|father|mother|son|daughter|siblings?|sisters?|brothers?)\b|\b[A-Z][a-z]+(?=,| is\b| wants\b| must\b| lives\b| works\b| discovers\b| finds\b)'),
    ('character_details', 'Character details', r'character (?:details?|descriptions?)|personality|appearance|traits?', r'\b(?:shy|stubborn|reckless|patient|impulsive|timid|reserved|outspoken|scarred|freckled|cautious|loyal|jealous)\b|\b(?:\d+[- ]year[- ]old|wears?\s+\w+|has\s+(?:\w+\s+)?(?:hair|eyes|scar))\b'),
    ('motivation', 'Motivation', r'motivation|goals?|desires?', r'\b(?:wants?|hopes?|tries|trying|needs?|determined)\s+to\s+\w+|\bin order to\s+\w+'),
    ('setting', 'Setting', r'settings?|locations?|world(?:building)?|place|time period', r'\b(?:in|on|at|inside|across|beneath|under)\s+(?:(?:a|an|the)\s+)?(?:[\w-]+\s+){0,3}(?:city|village|town|forest|castle|kingdom|island|lighthouse|desert|station|planet|school|sea|ocean|mountains?|Paris|London|Chicago)\b'),
    ('conflict', 'Conflict', r'conflict|obstacle|antagonist', r'\b(?:but|however|versus|against)\b.{5,}|\b(?:must|forced to|struggles? to|battles?|fights?)\s+\w+'),
    ('stakes', 'Stakes', r'stakes|consequences?', r'\b(?:or else|otherwise|risks?|at stake|will lose|could lose|before .{1,60}(?:dies|disappears|destroyed))\b|\bif .{1,60}(?:fails?|doesn.t|cannot|can.t)\b'),
    ('tone', 'Tone and viewpoint', r'tone(?: and viewpoint)?|mood|pov|point of view|viewpoint', r'\b(?:first[- ]person|third[- ]person|second[- ]person|omniscient|melancholic|lighthearted|humorous|hopeful|dark fantasy|satirical)\b'),
    ('structure', 'Structure', r'structure|pacing|outline|ending', r'\b(?:three[- ]act|nonlinear|non-linear|alternating|flashbacks?|circular|chronological|open ending|tragic ending|happy ending)\b'),
)
EXTRA_RULES = (
    ('relationships','Relationships',r'relationships?|family bonds?|rivalry',r'\b(?:siblings?|married|friendship|rivalry|trusts?|distrusts?|estranged)\b'),
    ('arc','Character arc',r'character arc|inner change|flaw|growth',r'\b(?:learns? to|overcomes?|changes? from|fatal flaw)\b'),
    ('theme','Themes',r'themes?|central question',r'\b(?:theme of|explores? (?:grief|power|identity|belonging|justice))\b'),
    ('world_rules','World rules',r'world rules?|magic system|technology rules?',r'\b(?:magic|technology)\s+(?:can only|cannot|requires|costs)\b'),
    ('sensory','Sensory detail',r'sensory details?|atmosphere|textures?',r'\b(?:smells? of|scent of|tastes? like|texture of)\b'),
    ('dialogue','Dialogue and voice',r'dialogue(?: and voice)?|speech patterns?|character voices?',r'\b(?:speaks? in|dialogue should|distinct voices?)\b'),
    ('pacing','Pacing',r'pacing|tempo|story speed|beat budget',r'\b(?:slow[- ]burn|unhurried|deliberate pace|fast[- ]paced|linger on)\b'),
    ('boundaries','Audience and boundaries',r'audience(?: and boundaries)?|content boundaries|age rating|things to avoid',r'\b(?:for ages? \d|no gore|family[- ]friendly|adult audience)\b'),
    ('opening','Opening situation',r'opening(?: situation)?|inciting incident',r'\b(?:begins? with|opens? with|inciting incident)\b'),
    ('ending','Ending direction',r'ending(?: direction)?|resolution|payoff',r'\b(?:ends? with|ends? when|final resolution)\b'),
    ('subplots','Subplots',r'subplots?|secondary threads?',r'\b(?:meanwhile|secondary storyline|parallel thread)\b'),
    ('continuity','Continuity and limits',r'continuity(?: and limits)?|timeline|knowledge limits',r'\b(?:does not know|has not learned|keep .{1,30} secret until)\b'),
)
MEDIUM_RULES = {
    'screenplay': (
        ('visual_action','Visible action',r'visible action|visual storytelling|screen action',r'\b(?:shown through|visible behavior)\b'),
        ('runtime','Screen runtime',r'screen runtime|runtime|screen length',r'\b\d+[- ]minute (?:film|movie)\b'),
        ('scene_design','Scene design',r'scene design|scene transitions|sluglines?',r'\b(?:INT\.|EXT\.|scene transitions?)'),
    ),
    'comic_script': (
        ('panels','Pages and panels',r'pages?(?: and panels)?|panels?',r'\b\d+ panels?\b'),
        ('visual_action','Drawable action',r'drawable action|visual storytelling',r'\b(?:one action per panel|page turn)\b'),
        ('lettering','Dialogue and captions',r'lettering|captions?|speech balloons?',r'\b(?:speech balloons?|caption boxes?)\b'),
    ),
    'documentary': (
        ('research','Research and sources',r'research(?: and sources)?|evidence|citations?',r'\b(?:archive|primary sources?|verified facts?)\b'),
        ('interviews','Interview approach',r'interviews?(?: approach)?|contributors?',r'\b(?:interview subjects?|ask witnesses)\b'),
        ('visual_action','Footage and narration',r'footage(?: and narration)?|b-roll|voiceover',r'\b(?:archival footage|b-roll|voiceover)\b'),
        ('ethics','Consent and uncertainty',r'consent(?: and uncertainty)?|ethics|fact checking',r'\b(?:informed consent|unverified claims?|fact[- ]check)\b'),
    ),
    'audio_drama': (
        ('sound_design','Sound storytelling',r'sound storytelling|sound design|audio cues?',r'\b(?:SFX|audible action|sound cues?)\b'),
        ('voices','Voice separation',r'voice separation|voice casting',r'\b(?:distinct vocal|recognizable voices?)\b'),
    ),
    'stage_play': (
        ('staging','Staging and entrances',r'staging(?: and entrances)?|entrances|stage directions?',r'\b(?:stage left|stage right|blackout|exits?)\b'),
        ('acts','Acts and scene breaks',r'acts?(?: and scene breaks)?|intermission',r'\b(?:ACT [IVX]+|intermission)\b'),
    ),
}

def rules_for(medium):
    from .media import contract
    name=contract({'medium':medium or 'book'})['medium']
    special=MEDIUM_RULES.get('screenplay' if name=='television' else name,())
    base=RULES + EXTRA_RULES
    if name=='documentary':
        labels={'characters':('Subjects and contributors',r'subjects?(?: and contributors)?|contributors?'),'character_details':('Subject background',r'subject background|biography'),'world_rules':('Factual context',r'factual context|historical context'),'arc':('Discovery arc',r'discovery arc|investigation'),'stakes':('Why this matters',r'why this matters|public relevance')}
        base=tuple((ident,*labels[ident],pattern) if ident in labels else (ident,label,topics,pattern) for ident,label,topics,pattern in base)
    return base + special
HELP = re.compile(r'^\s*(?:[-*•]\s*|\d+[.)]\s+)?(?:please\s+)?(?:help(?:\s+me)?(?:\s+(?:with|to))?|(?:can|could)\s+you\s+(?:help(?:\s+me)?|suggest|develop)|suggest|ideas? for|brainstorm|come up with|ideate|flesh out|expand(?:\s+on)?)\b', re.I)
PLACEHOLDER = re.compile(r'^(?:tbd|tba|none|unknown|unspecified|not sure|undecided|to be decided|help|\?+|\.{3})[.!?]*$', re.I)


def fingerprint(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def analyze(text, structure='', medium='Novel'):
    if not isinstance(text, str) or len(text) > 60000:
        raise ValueError('Idea must be text under 60000 characters')
    if not isinstance(structure, str) or len(structure) > 60000:
        raise ValueError('Structure must be text under 60000 characters')
    lines = text.splitlines()
    help_lines = [line for line in lines if HELP.match(line)]
    ordinary = [line for line in lines if not HELP.match(line)]
    details = []
    for ident, label, topics, pattern in rules_for(medium):
        topic = re.compile(r'\b(?:' + topics + r')\b', re.I)
        requested = [line for line in help_lines if topic.search(line)]
        evidence = []
        explicit_empty = False
        for line in ordinary:
            labelled = re.match(r'^\s*(?:[-*•]\s+)?(?:' + topics + r')\s*:\s*(.*)$', line, re.I)
            if labelled:
                value = labelled[1].strip()
                if value and not PLACEHOLDER.fullmatch(value): evidence.append(line)
                else: explicit_empty = True
            elif re.search(pattern, line, 0 if ident=='characters' else re.I): evidence.append(line)
        if ident == 'structure' and structure.strip(): evidence.append(structure)
        details.append({'id': ident, 'label': label, 'status': 'provided' if evidence else 'needs_detail' if explicit_empty else 'not_detected', 'evidence': evidence[:3], 'help_quotes': requested})
    # A general ideation request is a separate, explicit replacement slot. It
    # cannot authorize replacing neighbouring facts or the whole description.
    general = [line for line in help_lines if not any(line in d['help_quotes'] for d in details)]
    return {'rule_version': RULE_VERSION, 'medium':medium,'source_hash': fingerprint(text), 'details': details, 'general_help': general}


def targets(state, suggest=True, advice=""):
    if not isinstance(advice,str) or len(advice)>6000:raise ValueError("Keep your advice request under 6000 characters")
    rows = []
    seen = set()
    for detail in state['details']:
        for quote in detail['help_quotes']:
            if quote not in seen:
                rows.append({'id': f'help_{len(rows)}', 'aspect': detail['label'], 'aspect_id': detail['id'], 'action': 'replace_help', 'quote': quote})
                seen.add(quote)
    for quote in state['general_help']:
        rows.append({'id': f'help_{len(rows)}', 'aspect': 'Requested idea help', 'aspect_id': 'idea', 'action': 'replace_help', 'quote': quote})
    if advice.strip():
        requested=[(ident,label) for ident,label,topics,_ in rules_for(state.get('medium','Novel')) if re.search(r'\b(?:'+topics+r')\b',advice,re.I)]
        if not requested:requested=[('idea','Your advice request')]
        for ident,label in requested:
            rows.append({'id':'advice_'+ident,'aspect':label,'aspect_id':ident,'action':'append','quote':''})
        return rows[:6]
    if suggest:
        rows.extend({'id': d['id'], 'aspect': d['label'], 'aspect_id': d['id'], 'action': 'append', 'quote': ''} for d in state['details'] if d['status'] != 'provided' and not d['help_quotes'])
        if not rows:
            # Deepen the least-developed aspects. Accepted labelled additions
            # increase their evidence, naturally bringing other aspects forward.
            ordered=sorted(state['details'],key=lambda d:(len(d['evidence']),sum(map(len,d['evidence']))))
            rows.extend({'id':'deepen_'+d['id'],'aspect':d['label'],'aspect_id':d['id'],'action':'append','quote':'','deepen':True,'existing_evidence':d['evidence']} for d in ordered)
    return rows[:6]


PROMPT = '''You develop AUTHOR PROMPTS, never story prose. Return only JSON:
{"suggestions":[{"id":"exact requested slot id","detail":"short concrete brief instruction","reason":"why this detail helps"}]}.
Return one suggestion for each requested slot and no other slots. Each detail is
one or two compact planning sentences (at most 70 words), written as a prompt
instruction such as "Make the protagonist a cautious mapmaker who hides her
failing eyesight." Do not write scenes, dialogue, openings, narrative paragraphs,
a completed story, a rewritten author prompt, or generic questions. Preserve all
explicit author facts and constraints. Use prior chapters only for continuity.
For help slots fulfill that exact request, preserving constraints in its quote.
For missing details propose a specific choice; do not treat proposals as canon.
For deepen slots add a NEW compatible layer to the existing detail: a concrete
limitation, choice, relationship tension, physical specificity or development.
Do not repeat or contradict accepted details. Match the chosen medium. Every
suggestion remains a planning instruction, including documentary research plans.
Answer advice_request when supplied. The advice box is separate from the author
prompt; propose concrete prompt additions that answer it, not a conversational
reply or a rewritten story. Coverage and replacement scope are supplied by the application, do not alter them.'''


def result(text, state, slots, output):
    """Ignore all model-authored text/edit scopes; bind details to allowed slots."""
    rows = output.get('suggestions') if isinstance(output, dict) else None
    if not isinstance(rows, list) or len(rows) != len(slots):
        raise ValueError('Idea suggestions were incomplete. Try developing the idea again.')
    by_id = {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get('id'), str) or row['id'] in by_id:
            raise ValueError('Idea suggestions could not be read')
        detail, reason = row.get('detail'), row.get('reason')
        if not isinstance(detail, str) or not detail.strip() or len(detail) > 800 or len(detail.split()) > 90 or '\n\n' in detail:
            raise ValueError('Expected a short prompt detail, not story prose')
        if not isinstance(reason, str) or not reason.strip() or len(reason) > 500:
            raise ValueError('Expected a short suggestion reason')
        by_id[row['id']] = (detail.strip(), reason.strip())
    if set(by_id) != {slot['id'] for slot in slots}:
        raise ValueError('Suggestions did not match the requested details')
    suggestions = []
    for slot in slots:
        detail, reason = by_id[slot['id']]
        # Label the accepted addition so subsequent rule checks recognize it.
        replacement = f"{slot['aspect']}: {detail}"
        suggestions.append({**slot, 'replacement': replacement, 'suggestion': reason, 'reason': reason})
    return {'title': 'Your idea', 'text': text, 'detail_state': state, 'suggestions': suggestions, 'assumptions': [], 'prompt_only': True}
