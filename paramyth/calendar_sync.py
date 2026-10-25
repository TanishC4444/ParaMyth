"""Explicit, idempotent Google Calendar sync for production plans."""
from __future__ import annotations
from datetime import datetime
import json
import os
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, build_opener
from zoneinfo import ZoneInfo

from .production_exports import event_id
from .providers import NoRedirect, ProviderError, request_json


class GoogleCalendar:
    """Tokens stay in process memory or server environment, never in plan artifacts."""
    def __init__(self):
        self.access=os.getenv('GOOGLE_CALENDAR_ACCESS_TOKEN','')
        self.refresh=os.getenv('GOOGLE_CALENDAR_REFRESH_TOKEN','')
        self.expires=0

    def token(self):
        if self.access and (not self.expires or time.time()<self.expires-60):return self.access
        if self.refresh and os.getenv('GOOGLE_CLIENT_ID') and os.getenv('GOOGLE_CLIENT_SECRET'):
            self.accept(self.form_token({'grant_type':'refresh_token','refresh_token':self.refresh}))
            return self.access
        raise ProviderError('Connect Google Calendar first, or configure server-side Calendar OAuth credentials. ICS export works without Google authorization.')

    def form_token(self, values):
        values={**values,'client_id':os.getenv('GOOGLE_CLIENT_ID',''),'client_secret':os.getenv('GOOGLE_CLIENT_SECRET','')}
        try:
            with build_opener(NoRedirect()).open(Request('https://oauth2.googleapis.com/token',data=urlencode(values).encode(),headers={'Content-Type':'application/x-www-form-urlencoded'}),timeout=30) as response:
                return json.load(response)
        except (HTTPError,URLError,OSError,ValueError):raise ProviderError('Google authorization failed; check client credentials, consent and redirect URI') from None

    def accept(self, value):
        self.access=value['access_token'];self.refresh=value.get('refresh_token',self.refresh)
        self.expires=time.time()+value.get('expires_in',3600)

    def request(self, path, payload=None):
        return request_json('https://www.googleapis.com/calendar/v3/'+path,payload,{'Authorization':'Bearer '+self.token(),'Content-Type':'application/json'},timeout=30)

    def sync(self, plan, calendar='primary'):
        # Preview is supplied by the application; this is only called by its explicit sync action.
        from .pipeline.production_exports import calendar_events
        events=calendar_events(plan)
        if not events:return {'created':[],'existing':[],'conflicts':[]}
        if plan['schedule']['unscheduled']:raise ValueError('Resolve unscheduled scenes before syncing')
        path='calendars/'+quote(calendar,safe='')+'/events'
        lo=min(e['start'] for e in events);hi=max(e['end'] for e in events)
        query={'timeMin':lo,'timeMax':hi,'singleEvents':'true','maxResults':1000}
        existing=[]
        for page in range(6):
            data=self.request(path+'?'+urlencode(query));existing+=data.get('items',[])
            if not data.get('nextPageToken'):break
            query['pageToken']=data['nextPageToken']
        else:raise ValueError('Calendar range too large to check safely; use a dedicated production calendar')
        known={e['id'] for e in existing};out={'created':[],'existing':[],'conflicts':[]}
        def edge(raw):
            if 'dateTime' in raw:return datetime.fromisoformat(raw['dateTime'].replace('Z','+00:00'))
            return datetime.fromisoformat(raw['date']).replace(tzinfo=ZoneInfo(plan['config']['timezone']))
        for e in events:
            ident=event_id(plan,e)
            if ident in known:out['existing'].append(e['scene_id']);continue
            conflicts=[x for x in existing if x.get('status')!='cancelled' and x.get('transparency')!='transparent' and edge(x['start'])<datetime.fromisoformat(e['end']) and edge(x['end'])>datetime.fromisoformat(e['start'])]
            if conflicts:
                out['conflicts'].append({'scene_id':e['scene_id'],'message':'Existing calendar event overlaps; resolve before sync'});continue
            body={'id':ident,'summary':e['summary'],'location':e['location'],'description':'ParaMyth draft production plan. Scene '+e['scene_id']+'. Cast: '+', '.join(e['cast']),
                  'start':{'dateTime':e['start'],'timeZone':plan['config']['timezone']},'end':{'dateTime':e['end'],'timeZone':plan['config']['timezone']},'status':'tentative','visibility':'private','extendedProperties':{'private':{'paramyth_plan':plan['id'],'scene_id':e['scene_id']}}}
            try:result=self.request(path+'?sendUpdates=none',body)
            except ProviderError as exc:
                if str(exc)=='Provider HTTP 409':out['existing'].append(e['scene_id']);continue
                # Preserve partial results if the provider fails after some inserts.
                out['error']=str(exc);out['stopped_at']=e['scene_id'];break
            out['created'].append({'scene_id':e['scene_id'],'event_id':result.get('id',ident),'url':result.get('htmlLink','')})
        return out
