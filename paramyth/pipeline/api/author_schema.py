"""Validate editable author records before touching project files."""
import json


def validate_project(p):
    def require(ok,message):
        if not ok:raise ValueError(message)
    def text(obj,keys):
        require(isinstance(obj,dict),'Expected an object')
        require(all(isinstance(obj.get(k),str) for k in keys),'Expected text fields: '+', '.join(keys))
    def rows(obj,key):
        value=obj.get(key,[])
        require(isinstance(value,list) and len(value)<=2000,'Invalid '+key)
        return value
    require(isinstance(p,dict),'Supply a project object')
    require(len(json.dumps(p))<=5000000,'Project exceeds 5 MB')
    text(p,['title']);require(0<len(p['title'].strip())<=150,'Title must contain 1–150 characters')
    b=p.get('brief');text(b,['premise','medium','genre','tone','pov'])
    require(b['medium'] in ('Novel','Short story','Stage play','Screenplay','Audio drama','Comic script'),'Unsupported medium')
    for k in ('themes','worldRules','mustAvoid'):require(all(isinstance(x,str) for x in rows(b,k)),'Invalid '+k)
    for k,maximum in [('chapters',100),('scenesPerChapter',100),('wordMin',20000),('wordMax',20000)]:
        require(type(b.get(k)) is int and 1<=b[k]<=maximum,'Invalid '+k)
    require(b['wordMax']>=b['wordMin'],'Maximum length must be at least the minimum')
    for c in rows(b,'characters'):
        text(c,['id','name','goal','fear','voice']);text(c.get('arc'),['belief','pressure','choice','change'])
    for s in rows(p,'scenes'):
        text(s,['id','title','pov','location','content'])
        require(s.get('state') in ('Draft','Provisional','In review','Accepted'),'Invalid scene state')
        require(type(s.get('chapter')) is int and s['chapter']>0,'Invalid scene chapter')
        require(type(s.get('minutes')) in (int,float) and s['minutes']>=0,'Invalid scene timing')
        require(type(s.get('night')) is bool,'Invalid scene lighting')
        for f in rows(s,'findings'):
            text(f,['id','dimension','severity','quote','note','status','source'])
    for f in rows(p,'canon'):
        text(f,['id','kind','text','sceneId','state'])
        require(all(isinstance(h,str) for h in rows(f,'holders')),'Invalid knowledge holders')
    for v in rows(p,'versions'):
        text(v,['id','label','created']);rows(v,'scenes')
    for values in (b.get('characters',[]),p.get('scenes',[]),p.get('canon',[])):
        require(len({v['id'] for v in values})==len(values),'Duplicate record IDs')
    return p
