"""Department work plans, calculated resource quantities and local travel leads."""
from datetime import date,datetime,timedelta,time
from math import ceil
from zoneinfo import ZoneInfo
from .production_research import ProviderError

DEPARTMENTS={
 'development_rights':'Development, script and rights',
 'producing_finance':'Producing, finance and accounting',
 'locations':'Scouting, locations and base camp',
 'art_sets_props':'Art direction, set build and props',
 'costume_makeup':'Costume, hair and makeup',
 'casting':'Casting and performer needs',
 'direction':'Direction, rehearsals and shot planning',
 'camera_lighting':'Camera, lenses, grip and lighting',
 'sound_music':'Production sound, music and sound design',
 'crew_payroll':'Crew, payroll, working hours and welfare',
 'travel_transport':'Travel, vehicles, freight and transfers',
 'accommodation_meals':'Accommodation, catering and water',
 'safety_accessibility':'Safety, stunts, medical and accessibility',
 'permits_insurance':'Permits, releases, insurance and local counsel',
 'data_management':'Media, backups and continuity',
 'post_vfx':'Editing, VFX, grading, mix and captions',
 'delivery':'Delivery, clearances and distribution',
 'contingency':'Weather, fallback scenes and cost contingency',
}

OPERATIONS='''Build a detailed, proportionate production work plan for THIS scene breakdown.
Make concrete scene-specific decisions with short justifications, not generic
advice and not hidden reasoning. Cover EVERY supplied department. Mark a department
not_applicable only with a scene-based reason. Include sets versus real locations,
set construction/strike, materials/props continuity, practical power/toilets/basecamp,
costume fittings, casting/rehearsal/shot lists, lens/grip/lighting needs, sound kit,
data wrangling/backups, travel/freight/vehicles/parking, lodging/meal quantities,
insurance/permits/rights, minors/animals/weapons/water/stunts when present,
medical/accessibility/heat/weather risks, rushes/edit/VFX/ADR/grade/mix/captions/QC
and final delivery. Do not invent permissions, availability, contacts or quotations.
Scale crew/equipment and scope to the hard budget cap. Identify infeasible asks.
Return JSON {"departments":[{"id":"exact supplied key","status":"planned|not_applicable",
"rationale":"scene-specific need or why not needed","tasks":[{"id":"unique short id",
"task":"concrete action","owner":"role","deliverable":"checkable result",
"anchor":"first_shoot|last_shoot","offset_days":-7,"duration_hours":2,
"dependencies":["other task id"],"scene_ids":["s01"]}]}],
"crew":[{"role":"...","count":1,"shoot_days":1,"prep_days":2,"post_days":0,"daily_low":100,"daily_high":200,"basis":"unverified scope estimate"}],
"equipment":[{"item":"specific kit","quantity":1,"rental_days":2,"daily_low":20,"daily_high":40,"purpose":"scene need, including consumables/backups","scene_ids":["s01"]}],
"sets":[{"name":"...","scene_ids":["s01"],"approach":"location/set/VFX mix","build_and_strike":"materials, labour and lead time","props_continuity":"...","power_access_safety":"..."}],
"assumptions":["headcount/scope assumptions"],"constraints_conflicts":["..."],
"arrival_airport":"3-letter IATA airport serving proposed filming region, or empty if unknown"}.
Exactly one entry for each supplied department; 1-2 tasks per planned department,
at most 40 tasks total. At most 12 crew roles, 12 equipment entries and 8 sets.
Rates are daily PER PERSON or PER EQUIPMENT ITEM in the requested currency and
must be labelled estimates, not market research. Use zero if unknown. Whole
shoot days come from schedule; prep/post days must explain additional paid time.
Only bill each role for the days actually needed; a post-only editor can have
zero shoot_days. Total crew counts must fit supplied crew_size when nonzero.
Combine compatible roles for a small crew and explain that choice. Do not assume
every department requires a separate hire. Conflicts require explicit tradeoffs.
Rental days must cover the shoot plus stated pickup/return needs, not arbitrary
weeks. Use <=8h task blocks. Tasks before filming have negative offsets; post
tasks use last_shoot with positive offsets. Dependencies must be acyclic and
their completion must precede dependent tasks. Plan realistic prep lead time.'''


def develop_operations(model,breakdown,cfg,timing,progress):
    from .production import ask_validated,number,strings
    scenes={s['id'] for s in breakdown['scenes']}
    def validate(value):
        if not isinstance(value,dict):raise ValueError('Supply a department plan object')
        depts=value.get('departments',[])
        if not isinstance(depts,list) or {d.get('id') for d in depts if isinstance(d,dict)}!=set(DEPARTMENTS) or len(depts)!=len(DEPARTMENTS):raise ValueError('Include each of the 18 department IDs exactly once')
        tasks=[]
        for d in depts:
            if d.get('status') not in ('planned','not_applicable') or not isinstance(d.get('rationale'),str):raise ValueError('Explain each department scope')
            if not isinstance(d.get('tasks'),list) or len(d['tasks'])>3:raise ValueError('Supply at most three tasks per department')
            if d['status']=='planned' and not d['tasks']:raise ValueError('Planned departments need actionable tasks')
            d['label']=DEPARTMENTS[d['id']]
            if d['status']=='not_applicable':
                d['tasks']=[t for t in d['tasks'] if isinstance(t,dict) and any(t.get(key) for key in ('task','action','owner','deliverable'))]
            for index,t in enumerate(d['tasks']):
                if not isinstance(t,dict):raise ValueError(d['id']+' tasks must be objects, not strings')
                if not t.get('id'):t['id']=d['id']+'_'+str(index+1)
                if isinstance(t.get('id'),int):t['id']=str(t['id'])
                if not t.get('task') and isinstance(t.get('action'),str):t['task']=t['action']
                for key in ('id','task','owner','deliverable'):
                    if not isinstance(t.get(key),str) or not 0<len(t[key])<=1500:raise ValueError(d['id']+' task '+str(index+1)+' needs nonempty text in the '+key+' field')
                if t.get('anchor') not in ('first_shoot','last_shoot'):raise ValueError('Use a shoot date anchor')
                t['offset_days']=int(number(t.get('offset_days'),-180,365,'task date offset'))
                t['duration_hours']=float(number(t.get('duration_hours'),.5,8,'task hours'))
                if not set(strings(t.get('scene_ids',[])))<=scenes:raise ValueError('Use scene IDs from the current breakdown')
                strings(t.get('dependencies',[]));t['department']=d['label'];tasks.append(t)
        if len(tasks)>40 or len({t['id'] for t in tasks})!=len(tasks):raise ValueError('Use at most 40 tasks with unique IDs')
        ids={t['id'] for t in tasks};done=set()
        while len(done)<len(ids):
            ready={t['id'] for t in tasks if set(t.get('dependencies',[]))<=done}
            if ready<=done:raise ValueError('Task dependencies must refer to existing tasks and contain no cycles')
            done|=ready
        for key,cap in [('crew',12),('equipment',12),('sets',8)]:
            if not isinstance(value.get(key),list) or len(value[key])>cap:raise ValueError('Supply a bounded '+key+' list')
        for row in value['crew']:
            if not isinstance(row.get('role'),str) or not isinstance(row.get('basis'),str):raise ValueError('Crew needs role and estimate basis')
            for k,lo,hi in [('count',1,100),('prep_days',0,180),('post_days',0,365)]:row[k]=int(number(row.get(k),lo,hi,k))
            row['shoot_days']=int(number(row.get('shoot_days',timing['shoot_days']),0,timing['shoot_days'],'crew shoot days'))
            check_rates(row,number)
        if cfg['crew_size'] and sum(c['count'] for c in value['crew'])>cfg['crew_size']:raise ValueError('Crew counts exceed the user crew-size ceiling; combine compatible roles without losing required work')
        for row in value['equipment']:
            if not isinstance(row.get('item'),str) or not isinstance(row.get('purpose'),str):raise ValueError('Explain each equipment item')
            row['quantity']=int(number(row.get('quantity'),1,200,'equipment quantity'));row['rental_days']=int(number(row.get('rental_days'),max(1,timing['shoot_days']),365,'rental days'))
            check_rates(row,number)
            if not set(strings(row.get('scene_ids',[])))<=scenes:raise ValueError('Unknown equipment scene')
        for row in value['sets']:
            if not all(isinstance(row.get(k),str) for k in ('name','approach','build_and_strike','props_continuity','power_access_safety')):raise ValueError('Specify set build, props, power and safety')
            if not set(strings(row.get('scene_ids',[])))<=scenes:raise ValueError('Unknown set scene')
        for key in ('assumptions','constraints_conflicts'):strings(value.get(key,[]))
        airport=value.get('arrival_airport','')
        import re
        if not isinstance(airport,str) or airport and not re.fullmatch('[A-Z]{3}',airport):raise ValueError('Use an IATA arrival airport or leave it empty')
        value['tasks']=tasks
        return value
    progress('Developing departments, set plans, crew and equipment requirements')
    value=ask_validated(model,OPERATIONS,{'department_ids':DEPARTMENTS,'breakdown':breakdown,'constraints':cfg,'schedule':timing},validate,progress=progress)
    return schedule_tasks(value,cfg,timing)


def schedule_tasks(value,cfg,timing):
    import re
    value['constraints_conflicts']=[x for x in value.get('constraints_conflicts',[]) if not re.match(r'^(?:none(?: identified)?|no conflicts?)(?:\b|$)',x,re.I) and not x.startswith(('Prep task ','Task '))]
    events=timing['events'];first=min((datetime.fromisoformat(e['start']).date() for e in events),default=date.fromisoformat(cfg['start_date']));last=max((datetime.fromisoformat(e['end']).date() for e in events),default=first)
    tz=ZoneInfo(cfg['timezone']);mapped={};owner_end={}
    pending=list(value['tasks'])
    while pending:
        ready=[t for t in pending if set(t.get('dependencies',[]))<=mapped.keys()]
        if not ready:raise ValueError('Task dependencies need repair before scheduling')
        def intended(t):return (first if t['anchor']=='first_shoot' else last)+timedelta(days=t['offset_days'])
        # Book the earliest ready task first. Input department order must not
        # push preparation behind an unrelated post-production task.
        for task in sorted(ready,key=intended)[:1]:
            day=(first if task['anchor']=='first_shoot' else last)+timedelta(days=task['offset_days'])
            if task['anchor']=='first_shoot' and task['offset_days']<0 and cfg['skip_weekends']:
                while day.weekday()>=5:day-=timedelta(days=1)
            start=datetime.combine(day,time(9),tz)
            if task.get('dependencies'):start=max(start,max(datetime.fromisoformat(mapped[i]['end']) for i in task['dependencies']))
            if task['owner'] in owner_end:start=max(start,owner_end[task['owner']])
            while True:
                if cfg['skip_weekends'] and start.weekday()>=5:start=datetime.combine(start.date()+timedelta(days=1),time(9),tz);continue
                if start.hour<9:start=datetime.combine(start.date(),time(9),tz)
                if start+timedelta(hours=task['duration_hours'])>datetime.combine(start.date(),time(17),tz):start=datetime.combine(start.date()+timedelta(days=1),time(9),tz);continue
                break
            end=start+timedelta(hours=task['duration_hours'])
            task.update(start=start.isoformat(),end=end.isoformat(),status='proposed',scene_id='task-'+task['id'],summary=task['task'],location=cfg['region'],cast=[task['owner']])
            if task['anchor']=='first_shoot' and task['offset_days']<0 and end.date()>=first:value['constraints_conflicts'].append('Prep task '+task['id']+' cannot finish before the shoot with its current dependencies.')
            if start.date()<date.today():value['constraints_conflicts'].append('Task '+task['id']+' is before today; move the shoot date or revise the lead time.')
            mapped[task['id']]=task;owner_end[task['owner']]=end;pending.remove(task)
    for department in value.get('departments',[]):
        for task in department.get('tasks',[]):
            if task['id'] in mapped:task.update(mapped[task['id']])
    return value


def check_rates(row,number):
    low=number(row.get('daily_low'),0,10000000,'daily low');high=number(row.get('daily_high'),0,10000000,'daily high')
    if low>high:raise ValueError('Order the daily estimate range')


def reconcile_resources(breakdown,operations,cfg,timing):
    crew=operations.get('crew',[]);equipment=operations.get('equipment',[])
    rows=[r for r in breakdown.get('budget_items',[]) if not (crew and r['category']=='crew' or equipment and r['category']=='equipment')]
    for c in crew:
        shoot=c.get('shoot_days',timing['shoot_days']);days=shoot+c['prep_days']+c['post_days']
        rows.append({'category':'crew','description':c['role'],'quantity':c['count']*days,'unit':'day','low_rate':c['daily_low'],'high_rate':c['daily_high'],'basis':f"Estimated: {c['count']} people × ({shoot} shoot + {c['prep_days']} prep + {c['post_days']} post days). "+c['basis']})
    for e in equipment:
        rows.append({'category':'equipment','description':e['item'],'quantity':e['quantity']*e['rental_days'],'unit':'day','low_rate':e['daily_low'],'high_rate':e['daily_high'],'basis':f"Estimated: {e['quantity']} items × {e['rental_days']} rental days. "+e['purpose']})
    breakdown['budget_items']=rows


def excluded_for_local_crew(row):
    description=row.get('description','').lower()
    if row.get('unit') in ('room-night','person-return'):return True
    if row.get('category')=='locations':return False
    travel=row.get('category') in ('travel','transport','accommodation')
    return (travel and any(word in description for word in ('hotel','lodging','accommodation','airfare','flight')) or any(phrase in description for phrase in ('crew hotel','crew accommodation','crew lodging','crew return flight','flight tickets'))) and not any(word in description for word in ('meal','cater','food'))


def research_logistics(search,cfg,timing,evidence,research,warnings,breakdown,operations,progress):
    first=min((datetime.fromisoformat(e['start']).date() for e in timing['events']),default=date.fromisoformat(cfg['start_date']))
    last=max((datetime.fromisoformat(e['end']).date() for e in timing['events']),default=first)
    checkin=first-timedelta(days=1);checkout=last+timedelta(days=1)
    count=cfg['crew_size'] or sum(c['count'] for c in operations.get('crew',[])) or 8
    nights=0 if cfg.get('local_crew') else (checkout-checkin).days;rooms=0 if cfg.get('local_crew') else ceil(count/2)
    region=cfg['region'];currency=cfg['currency'];arrival=cfg['arrival_airport'] or operations.get('arrival_airport','')
    out={'headcount':count,'headcount_basis':'user supplied' if cfg['crew_size'] else 'crew plan; cast/local hires must be confirmed','rooms':rooms,'nights':nights,'occupancy_assumption':'two adults per room; confirm room capacity and local hires','hotels':[],'meals':[],'transport':[],'equipment_suppliers':[],'medical':[],'flights':[],'missing':[],'check_in':checkin.isoformat(),'check_out':checkout.isoformat()}
    jobs=[] if cfg.get('local_crew') else [('hotels','google_hotels',region,{'check_in_date':checkin.isoformat(),'check_out_date':checkout.isoformat(),'adults':2,'currency':currency})]
    jobs += [('meals','google_maps','crew catering restaurants near '+region,{}),('transport','google_maps','passenger van rental production transport near '+region,{}),('equipment_suppliers','google_maps','film camera lighting sound rental near '+region,{}),('medical','google_maps','hospital emergency department near '+region,{})]
    if checkin<date.today() and not cfg.get('local_crew'):jobs=jobs[1:];out['missing'].append('Choose future shoot dates to research dated hotel and flight prices.')
    if not cfg.get('local_crew'):
        if cfg['departure_airport'] and arrival and checkin>=date.today():jobs.insert(1,('flights','google_flights',cfg['departure_airport']+' to '+arrival,{'departure_id':cfg['departure_airport'],'arrival_id':arrival,'outbound_date':checkin.isoformat(),'return_date':checkout.isoformat(),'type':1,'adults':1,'currency':currency}))
        else:out['missing'].append('Add a departure airport and confirm the destination airport to price flights; origin is never inferred from your timezone.')
    for key,engine,query,params in jobs:
        if len(research)>=cfg['search_limit']:out['missing'].append(key.replace('_',' ')+' research skipped: search allowance reached');continue
        progress('Finding '+key.replace('_',' ')+' around the proposed shoot region')
        try:
            result=search.search(query,key,engine=engine,parameters=params);research.append(result)
            for item in result['results']:
                existing=next((e for e in evidence if e['url']==item['url']),None)
                entry=existing or {**item,'id':'R'+str(len(evidence)+1),'retrieved_at':result['retrieved_at'],'evidence_level':result['evidence_level']}
                if not existing:evidence.append(entry)
                out[key].append(entry)
            if not result['results']:out['missing'].append('No '+key.replace('_',' ')+' leads were returned for these dates and region.')
        except ProviderError as exc:warnings.append(key.replace('_',' ')+': '+str(exc))
    # Price alternatives are visible rather than mixing one venue's cheapest
    # price with another's amenities. The lowest returned lead is an allowance.
    hotel_rates=[r['rate'] for r in out['hotels'] if r.get('rate') is not None and r.get('currency')==currency]
    flight_rates=[r['rate'] for r in out['flights'] if r.get('rate') is not None and r.get('currency')==currency]
    rows=breakdown['budget_items']
    if cfg.get('local_crew'):
        out['occupancy_assumption']='Local crew; accommodation and flights are not budgeted.'
        rows[:]=[row for row in rows if not excluded_for_local_crew(row)]
    def allowance(description,quantity,unit,rates,basis):
        rows.append({'category':'travel','description':description,'quantity':quantity,'unit':unit,'low_rate':min(rates) if rates else 0,'high_rate':max(rates) if rates else 0,'basis':basis})
    # Replace provisional accommodation/airfare lines, avoiding double counting.
    if hotel_rates:
        rows[:]=[r for r in rows if not any(w in r['description'].lower() for w in ('hotel','lodging','accommodation'))]
        allowance('Crew accommodation',rooms*nights,'room-night',hotel_rates,f'Live hotel search allowance: {rooms} rooms × {nights} nights, 2 adults per room. Dates {checkin}–{checkout}; taxes/fees/capacity unconfirmed.')
    elif rooms and not any(any(w in r['description'].lower() for w in ('hotel','lodging','accommodation')) for r in rows):allowance('Crew accommodation',rooms*nights,'room-night',[],f'{rooms} rooms × {nights} nights; quote needed')
    if flight_rates:
        rows[:]=[r for r in rows if not any(w in r['description'].lower() for w in ('flight','airfare'))]
        allowance('Crew return flights',count,'person-return',flight_rates,f'Live economy fare leads × {count} travelers, excluding baggage/freight/ground transfers.')
    if not any(any(w in r['description'].lower() for w in ('meal','cater','food')) for r in rows):allowance('Crew meals and water',count*max(1,timing['shoot_days']),'person-day',[],f'{count} people × {timing["shoot_days"]} shoot days. Dietary needs and local catering quote required.')
    return out
