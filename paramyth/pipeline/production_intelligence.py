"""Evidence-backed region comparisons and conservative production rate updates."""
import os
import re
from .production_research import Search, ProviderError

DIRECTION = '''Propose a practical production adaptation of the supplied writing.
Honor explicit region, budget ceiling, crew, travel and schedule constraints.
The user's timezone is NOT their filming location. Distinguish the story setting
from locations that can double for it. Compare up to three plausible real filming
regions by architecture/terrain, production infrastructure, travel and total cost.
Derive all candidate regions from this project's actual setting, era, visual
requirements, geography, production needs and constraints. Do not reuse locations
from examples, earlier projects or prior output. Research viable candidates
worldwide rather than favoring any fixed city or country. A small budget can
justify a controlled set in a named city, reduced scope or VFX, but explain the
visual compromise. Preserve a user-specified filming region as a hard constraint.
Choose sensible workday, setup, move and contingency settings based on actual
scene needs. Suggest a timezone for the proposed region. Keep supplied currency,
start date and budget cap; a predicted budget is an estimate, NOT a new cap.
Every region MUST be a named real city and country, including controlled-set
alternatives. "Local soundstage", "controlled studio set", "nearby" and "home"
are NOT geographic regions. Do not assume the crew's origin or that travel is
eliminated: no origin has been supplied unless the constraints explicitly say so.
Return JSON: {"brief":"specific approach, scope and practical staging",
"region":"city, country","reason":"why","assumptions":["..."],
"candidates":[{"region":"city, country","visual_fit":"...","cost_tradeoff":"..."}],
"discovery_query":"short public search for film commission/location libraries comparing these story-appropriate regions",
"suggested_config":{"day_hours":8,"setup_minutes":45,"move_minutes":60,"contingency":20,"timezone":"IANA timezone for the selected filming region","skip_weekends":true},
"predicted_budget":{"low":0,"high":0,"basis":"unknown or scope-based model estimate, not a researched price"},
"image_prompts":[{"title":"...","prompt":"..."}],"sound_prompt":"musical direction only"}.
Use 2-3 visual prompts. Do not invent quotations, availability or current prices.'''


def develop_direction(sources,config,model,*,folder=None,search=None,progress=lambda message:None):
    from .production import ask_validated,validate_direction,normalize_config,number
    def validate(value):
        value=validate_direction(value,config)
        candidates=value.get('candidates',[])
        if not isinstance(candidates,list) or len(candidates)>3 or any(not isinstance(c,dict) or not all(isinstance(c.get(k),str) and 0<len(c[k])<1500 for k in ('region','visual_fit','cost_tradeoff')) for c in candidates):raise ValueError('Supply up to three region comparisons')
        if not config['region']:
            for region in [value['region']]+[c['region'] for c in candidates]:
                if ',' not in region or re.search(r'\b(?:local soundstage|controlled studio|local studio|undecided|TBD|to be determined|nearby|user.s (?:city|location)|your (?:city|location))\b',region,re.I):raise ValueError('Each region must name a real city and country. Name the city of a controlled-set option; never use a generic local studio as a region or assume where the crew lives.')
        proposed=value.get('suggested_config',{})
        allowed={'day_hours','setup_minutes','move_minutes','contingency','timezone','skip_weekends','start_date'}-set(config.get('locked_settings',[]))
        if not isinstance(proposed,dict):raise ValueError('Supply schedule settings as an object')
        merged=normalize_config({**config,**{k:v for k,v in proposed.items() if k in allowed}})
        value['suggested_config']={k:merged[k] for k in allowed}
        predicted=value.get('predicted_budget',{'low':0,'high':0,'basis':'Unknown until a scene breakdown is prepared'})
        if not isinstance(predicted,dict):raise ValueError('Supply an estimated budget range')
        lo=number(predicted.get('low'),0,100000000,'predicted budget');hi=number(predicted.get('high'),0,100000000,'predicted budget')
        if lo>hi or not isinstance(predicted.get('basis'),str):raise ValueError('Supply an ordered budget estimate with a basis')
        value['predicted_budget']={**predicted,'currency':config['currency'],'status':'unverified planning estimate'}
        return value
    value=ask_validated(model,DIRECTION,{'sources':[{'file':s['file'],'text':s['text'][:12000]} for s in sources[:6]],'constraints':config},validate,progress=progress)
    value.update(research=[],evidence=[],warnings=[])
    if folder is None or not config['search_limit']:return value
    search=search or Search(folder/'production',daily_limit=os.getenv('PARAMYTH_SEARCH_DAILY_LIMIT','30'),plan_limit=config['search_limit'])
    query=value.get('discovery_query')
    if not isinstance(query,str) or not query.strip():query='film commission filming locations '+value['region']
    if config['region']:query='film commission filming locations '+config['region']
    progress('Comparing filming regions with SerpAPI location evidence')
    try:
        result=search.search(query,'location');value['research']=[result]
        value['evidence']=[{**r,'id':'R'+str(i+1),'retrieved_at':result['retrieved_at'],'evidence_level':result['evidence_level']} for i,r in enumerate(result['results'])]
    except ProviderError as exc:value['warnings'].append(str(exc));return value
    if not value['evidence'] or config['region']:return value
    candidates=value.get('candidates') or [{'region':value['region'],'visual_fit':value['reason'],'cost_tradeoff':'Needs verification'}]
    def rank(r):
        if not isinstance(r,dict) or type(r.get('candidate_index')) is not int or not 0<=r['candidate_index']<len(candidates):raise ValueError('Choose a supplied region candidate')
        refs=r.get('source_ids')
        if not isinstance(refs,list) or not refs or not set(refs)<={e['id'] for e in value['evidence']} or not isinstance(r.get('reason'),str):raise ValueError('Explain the selection using supplied source IDs')
        if r.get('timezone'):
            from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
            try:ZoneInfo(r['timezone'])
            except (ZoneInfoNotFoundError,TypeError):raise ValueError('Use the selected filming region IANA timezone')
        return r
    try:
        ranked=ask_validated(model,'Compare these candidate filming regions against the story visual requirements and the HARD user constraints. Prioritize authentic visual fit and production infrastructure, then feasibility within the ceiling, crew and travel constraints. Search snippets are leads, not price quotes. Do not treat a city as available or affordable without evidence. Return {"candidate_index":0,"source_ids":["R1"],"reason":"specific tradeoff, unresolved costs, scope compromises","timezone":"selected region IANA timezone"}.',{'candidates':candidates,'direction':value['brief'],'constraints':config,'evidence':value['evidence']},rank,progress=progress)
    except ProviderError:
        value['warnings'].append('The region comparison could not be confirmed from research. The initial region remains an unverified proposal.')
        return value
    initial_region=value['region']
    value['region']=candidates[ranked['candidate_index']]['region'][:300]
    value['reason']=ranked['reason'];value['selection_evidence']=ranked['source_ids']
    # A region selected by evidence can differ from the initial proposal.
    # Reuse the correct region timezone only if one was supplied for that candidate.
    if 'timezone' not in config.get('locked_settings',[]):
        if ranked.get('timezone'):value['suggested_config']['timezone']=ranked['timezone']
        elif value['region']!=initial_region:value['suggested_config'].pop('timezone',None)
    return value


def apply_price_evidence(model,breakdown,config,evidence,progress):
    """Apply quoted same-currency/unit rates only; preserve unknowns/estimates."""
    from .production import ask_validated,number
    items=breakdown.get('budget_items',[])
    progress('Matching published cost leads to the production budget')
    def validate(value):
        rows=value.get('rates') if isinstance(value,dict) else None
        if not isinstance(rows,list) or len(rows)>len(items):raise ValueError('Return a rates array no longer than the budget')
        seen=set();refs={e['id']:e for e in evidence}
        for r in rows:
            if not isinstance(r,dict) or type(r.get('item_index')) is not int or not 0<=r['item_index']<len(items) or r['item_index'] in seen:raise ValueError('Use unique budget item indexes')
            seen.add(r['item_index']);ids=r.get('source_ids',[]);quote=r.get('quote','')
            if not isinstance(ids,list) or not ids or not set(ids)<=set(refs) or not isinstance(quote,str) or not quote.strip():raise ValueError('Rate needs source IDs and an exact supporting snippet quote')
            if not any(quote in refs[i].get('snippet','') for i in ids):raise ValueError('Rate quote must appear verbatim in the supplied evidence')
            low=number(r.get('low_rate'),0,10000000,'published low rate');high=number(r.get('high_rate'),0,10000000,'published high rate')
            amounts={str(number(x.replace(',',''),0,100000000,'quoted amount').normalize()) for x in re.findall(r'\d[\d,]*(?:\.\d+)?',quote)}
            if low>high or str(low.normalize()) not in amounts or str(high.normalize()) not in amounts:raise ValueError('Published rate amounts must occur in the supporting quote')
            if r.get('currency')!=config['currency'] or r.get('unit')!=items[r['item_index']]['unit']:raise ValueError('Do not convert currencies or units without verified conversion data')
            units={'day':r'\b(?:daily|per day|a day)\b|/\s*day','hour':r'\b(?:hourly|per hour|an hour)\b|/\s*hr','person':r'\bper person\b','item':r'\b(?:per item|each|one.off)\b'}
            if config['currency'].casefold() not in quote.casefold() or not re.search(units.get(r['unit'],r'(?!)'),quote,re.I):raise ValueError('Quote must state the matching currency and billing unit explicitly')
        return rows
    rows=ask_validated(model,'Extract ONLY directly quoted prices from supplied search snippets for these exact budget categories, currency and unit. Return {"rates":[{"item_index":0,"low_rate":100,"high_rate":100,"currency":"USD","unit":"day","source_ids":["R1"],"quote":"exact contiguous snippet containing both amounts, currency and unit"}]}. If evidence lacks an explicit price, matching currency/unit, or a genuinely comparable service return no row. Never invent a quote, convert a currency or use unrelated tourist prices as film rental costs. An empty rates array is a valid and preferred result when no published rates match.',{'budget_items':items,'currency':config['currency'],'filming_region':config['region'],'evidence':evidence},validate,progress=progress)
    for row in rows:
        item=items[row['item_index']]
        item.update(low_rate=row['low_rate'],high_rate=row['high_rate'],source_ids=row['source_ids'],basis='Published search-snippet lead, not a booking quote: '+row['quote'])
    return rows
