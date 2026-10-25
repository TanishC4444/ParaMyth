"""Production plan exports: calendar, schedule, budget and task sheets, call sheets."""
from __future__ import annotations
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path


def event_id(plan, event):
    return hashlib.sha256((plan['title']+'|'+event['scene_id']+'|'+event['start']).encode()).hexdigest()


def utc(value):
    return datetime.fromisoformat(value).astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ')


def ics_escape(value):
    return str(value).replace('\\','\\\\').replace('\r','').replace('\n','\\n').replace(';','\\;').replace(',','\\,')


def calendar_ics(plan):
    lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//ParaMyth//Production//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH']
    for e in plan['schedule']['events']:
        lines += ['BEGIN:VEVENT','UID:'+event_id(plan,e)+'@paramyth.local','DTSTAMP:'+utc(plan['created_at']),
                  'DTSTART:'+utc(e['start']),'DTEND:'+utc(e['end']),'SUMMARY:'+ics_escape(e['summary']),
                  'LOCATION:'+ics_escape(e['location']),'DESCRIPTION:'+ics_escape('Tentative production shoot. Scene '+e['scene_id']+'. Cast: '+', '.join(e['cast'])+'. Verify permits, venue and availability.'),'STATUS:TENTATIVE','END:VEVENT']
    lines+=['END:VCALENDAR']
    folded=[]
    for line in lines:
        # Fold by octet, preserving complete UTF-8 characters (RFC 5545).
        chunk='';limit=75
        for char in line:
            if len((chunk+char).encode())>limit:
                folded.append(chunk);chunk=' '+char;limit=75
            else:chunk+=char
        folded.append(chunk)
    return ('\r\n'.join(folded)+'\r\n').encode()


def csv_bytes(rows, fields):
    stream=io.StringIO(newline='');writer=csv.DictWriter(stream,fieldnames=fields,extrasaction='ignore');writer.writeheader()
    for row in rows:
        sanitized={}
        for key,value in row.items():
            if isinstance(value,(list,dict)):value=json.dumps(value,ensure_ascii=False)
            if isinstance(value,str) and value.lstrip().startswith(('=','+','-','@')):value="'"+value
            sanitized[key]=value
        writer.writerow(sanitized)
    return stream.getvalue().encode('utf-8-sig')


def export(plan, kind):
    if kind=='calendar.ics': return calendar_ics(plan),'text/calendar; charset=utf-8'
    if kind=='budget.csv': return csv_bytes(plan['budget']['items'],['category','description','quantity','unit','low_rate','high_rate','low_total','high_total','basis','status']),'text/csv; charset=utf-8'
    if kind=='schedule.csv': return csv_bytes(plan['schedule']['events'],['scene_id','summary','start','end','location','cast','setup_move_minutes','meal_before','status']),'text/csv; charset=utf-8'
    if kind=='tasks.csv':
        return csv_bytes(plan['recommendations'].get('legal_logistics',[]),['task','owner','source_ids','status','verification']),'text/csv; charset=utf-8'
    if kind=='plan.json': return json.dumps(plan,ensure_ascii=False,indent=2).encode(),'application/json'
    if kind=='call-sheets.txt':
        lines=[plan['title'],'DRAFT CALL SHEETS — confirm crew, contacts, venue, safety plan and permissions before issue.']
        for e in plan['schedule']['events']:
            lines+=['',e['start']+' — '+e['end'],e['scene_id']+': '+e['summary'],'Location: '+e['location'],'Cast: '+', '.join(e['cast']),'Setup/move: '+str(e['setup_move_minutes'])+' minutes before scene','Meal before: '+str(e['meal_before']),'Emergency contact / nearest hospital / parking / weather / crew call: TO CONFIRM']
        return '\n'.join(lines).encode(),'text/plain; charset=utf-8'
    raise ValueError('Unknown export')


EXPORTS = ('calendar.ics', 'schedule.csv', 'budget.csv', 'tasks.csv', 'call-sheets.txt', 'plan.json')


def main():
    parser = argparse.ArgumentParser(description='Export a saved production plan')
    parser.add_argument('--plan', required=True, type=Path, help='Plan JSON under production/plans/')
    parser.add_argument('--kind', required=True, choices=EXPORTS)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    data, _ = export(json.loads(args.plan.read_text(encoding='utf-8')), args.kind)
    args.out.write_bytes(data)
    print(args.out)


if __name__ == '__main__':
    main()
