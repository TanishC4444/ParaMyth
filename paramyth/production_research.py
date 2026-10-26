"""Small, cached SerpAPI search allowance with ordered credential failover."""
from __future__ import annotations
import hashlib
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sqlite3
import time
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


from .providers import ProviderError, request_json


def search_key():
    """Allow the local Windows server to read a user-level key after hot reload."""
    value=os.getenv('SERPAPI_API_KEY','').strip()
    if value or os.name!='nt':return value
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,'Environment') as settings:
            value,_=winreg.QueryValueEx(settings,'SERPAPI_API_KEY')
        return value.strip() if isinstance(value,str) else ''
    except OSError:return ''


def safe_url(value):
    try:
        u = urlsplit(str(value))
        return str(value) if u.scheme in ('https', 'http') and u.hostname and not u.username else ''
    except ValueError:
        return ''


class Search:
    def __init__(self, folder, keys=None, daily_limit=10, plan_limit=2):
        configured = keys if keys is not None else [search_key(), *os.getenv('SERPAPI_BACKUP_KEYS', '').split(',')]
        self.keys = list(dict.fromkeys(k.strip() for k in configured if isinstance(k, str) and k.strip()))
        self.daily_limit = min(30, max(0, int(daily_limit)))
        self.plan_limit = min(12, max(0, int(plan_limit)))
        self.used = 0
        folder = Path(folder); folder.mkdir(parents=True, exist_ok=True)
        self.db = folder / 'search-cache.sqlite'
        with self.connect() as c:
            c.execute('CREATE TABLE IF NOT EXISTS cache (id TEXT PRIMARY KEY, expires REAL, body TEXT)')
            c.execute('CREATE TABLE IF NOT EXISTS attempts (at REAL, key_id TEXT)')
            c.execute('CREATE TABLE IF NOT EXISTS cooldown (key_id TEXT PRIMARY KEY, until REAL)')

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.db, timeout=20)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def reserve(self, key):
        fingerprint = hashlib.sha256(key.encode()).hexdigest()[:16]
        now = time.time()
        with self.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            row = c.execute('SELECT until FROM cooldown WHERE key_id=?', (fingerprint,)).fetchone()
            if row and row[0] > now: return False
            used = c.execute('SELECT count(*) FROM attempts WHERE at>?', (now - 86400,)).fetchone()[0]
            if used >= self.daily_limit: raise ProviderError('Daily search allowance reached; cached research is still available')
            c.execute('INSERT INTO attempts VALUES (?,?)', (now, fingerprint))
        return True

    def __call__(self, query, purpose='location', **options):
        return self.search(query, purpose, **options)

    def search(self, query, purpose='location', *, engine='google', parameters=None):
        if not isinstance(query, str) or not query.strip():
            raise ValueError('Search query must be nonempty text')
        if not isinstance(purpose, str) or not purpose.strip() or len(purpose) > 60:
            raise ValueError('Search purpose must be text between 1 and 60 characters')
        purpose = purpose.strip().lower()
        if engine not in ('google','google_maps','google_hotels','google_flights'):raise ValueError('Unsupported research service')
        parameters=parameters or {}
        allowed={'check_in_date','check_out_date','adults','currency','departure_id','arrival_id','outbound_date','return_date','type','ll','sort_by'}
        if not isinstance(parameters,dict) or not set(parameters)<=allowed:raise ValueError('Unsupported research parameter')
        query = ' '.join(str(query).split())[:240]
        ident = hashlib.sha256(json.dumps([engine,query.casefold(),purpose,parameters],sort_keys=True).encode()).hexdigest()
        now = time.time()
        with self.connect() as c:
            row = c.execute('SELECT body FROM cache WHERE id=? AND expires>?', (ident, now)).fetchone()
        if row: return {**json.loads(row[0]), 'cached': True}
        if self.used >= self.plan_limit: raise ProviderError('Per-plan search allowance reached')
        if not self.keys: raise ProviderError('SerpAPI is not configured; add server-side search keys')
        self.used += 1
        for key in self.keys[:3]:
            if not self.reserve(key): continue
            params = {'engine':engine, 'api_key':key, 'hl':'en',**parameters}
            if engine!='google_flights':params['q']=query
            if engine=='google':params['num']=5
            try:
                body = request_json('https://serpapi.com/search.json?' + urlencode(params), timeout=35)
            except ProviderError as exc:
                if str(exc) in ('Provider HTTP 401', 'Provider HTTP 403', 'Provider HTTP 429'):
                    fingerprint = hashlib.sha256(key.encode()).hexdigest()[:16]
                    with self.connect() as c:
                        c.execute('INSERT OR REPLACE INTO cooldown VALUES (?,?)', (fingerprint, now + 3600))
                    continue
                raise
            if not isinstance(body, dict):raise ProviderError('Search provider returned invalid results')
            if body.get('error'):
                error = str(body['error']).lower()
                if any(x in error for x in ('run out', 'limit', 'invalid api key', 'no searches')):
                    fingerprint = hashlib.sha256(key.encode()).hexdigest()[:16]
                    with self.connect() as c:
                        c.execute('INSERT OR REPLACE INTO cooldown VALUES (?,?)', (fingerprint, now + 3600))
                    continue
                # Empty results are a valid negative result: do not burn backup keys.
                if 'no results' not in error and 'hasn\'t returned any results' not in error:
                    raise ProviderError('Search provider could not complete this query')
            results=normalize_results(engine,body,parameters,query)
            result = {'engine':engine,'parameters':parameters,'query':query, 'purpose':purpose, 'results':results, 'retrieved_at':now, 'cached':False, 'evidence_level':'structured_search_result' if engine!='google' else 'search_snippet_only'}
            with self.connect() as c:
                c.execute('INSERT OR REPLACE INTO cache VALUES (?,?,?)', (ident, now + (21600 if purpose == 'legal' else 86400), json.dumps(result)))
            return result
        raise ProviderError('Search keys unavailable or exhausted; cooldown is active. Use cached research or try later.')


def normalize_results(engine,body,parameters,query):
    """Persist public leads and prices only, never raw credential-bearing URLs."""
    def objects(value):
        if not isinstance(value,list) or any(not isinstance(item,dict) for item in value):
            raise ProviderError('Search provider returned invalid results')
        return value

    def mapping(value):
        if not isinstance(value,dict):
            raise ProviderError('Search provider returned invalid results')
        return value

    def sequence(value):
        if not isinstance(value,list):
            raise ProviderError('Search provider returned invalid results')
        return value

    results=[]
    if engine=='google':
        organic=body.get('organic_results',[])
        if not isinstance(organic,list) or any(not isinstance(item,dict) for item in organic):raise ProviderError('Search provider returned invalid results')
        for item in organic[:5]:
            url=safe_url(item.get('link',''))
            if url:results.append({'title':str(item.get('title',''))[:300],'url':url,'snippet':str(item.get('snippet',''))[:1200]})
    elif engine=='google_maps':
        places=body.get('local_results',[])
        if isinstance(places,dict):places=places.get('places',[])
        for item in objects(places)[:5]:
            name=str(item.get('title',''))[:300];address=str(item.get('address',''))[:500]
            url=safe_url(item.get('website','')) or 'https://www.google.com/maps/search/?'+urlencode({'api':1,'query':name+' '+address})
            results.append({'title':name,'url':url,'snippet':address,'address':address,'rating':item.get('rating'),'price_level':item.get('price'),'coordinates':item.get('gps_coordinates'),'types':sequence(item.get('types',[]))[:8]})
    elif engine=='google_hotels':
        for item in objects(body.get('properties',[]))[:5]:
            rate=mapping(item.get('rate_per_night',{}));total=mapping(item.get('total_rate',{}))
            name=str(item.get('name',''))[:300]
            url=safe_url(item.get('link','')) or 'https://www.google.com/travel/hotels?'+urlencode({'q':name+' '+query})
            amount=rate.get('extracted_lowest');amount=amount if isinstance(amount,(int,float)) and amount>=0 else None
            results.append({'title':name,'url':url,'snippet':str(item.get('description',''))[:900],'coordinates':item.get('gps_coordinates'),'rating':item.get('overall_rating'),'amenities':sequence(item.get('amenities',[]))[:12],'rate':amount,'currency':parameters.get('currency'),'rate_unit':'room-night','total_rate':total.get('extracted_lowest'),'dates':{k:parameters[k] for k in ('check_in_date','check_out_date','adults')},'price_status':'live search lead; room capacity, taxes, fees and availability need confirmation'})
    elif engine=='google_flights':
        for item in (objects(body.get('best_flights',[]))+objects(body.get('other_flights',[])))[:5]:
            legs=[{'airline':f.get('airline'),'flight_number':f.get('flight_number'),'departure':f.get('departure_airport'),'arrival':f.get('arrival_airport')} for f in objects(item.get('flights',[]))]
            amount=item.get('price');amount=amount if isinstance(amount,(int,float)) and amount>=0 else None
            results.append({'title':parameters['departure_id']+' to '+parameters['arrival_id'],'url':'https://www.google.com/travel/flights?'+urlencode({'q':query}),'snippet':'Round-trip economy fare lead; baggage, transfers and availability need confirmation.','rate':amount,'currency':parameters['currency'],'rate_unit':'person-return','itinerary':legs,'duration_minutes':item.get('total_duration'),'dates':{k:parameters[k] for k in ('outbound_date','return_date')}})
    return results
