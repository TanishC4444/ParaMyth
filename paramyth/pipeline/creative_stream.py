"""Provider SSE decoding and safe partial JSON previews for creative drafts."""
import json
import os
import re
from urllib.request import Request, build_opener
from urllib.error import HTTPError, URLError
from .production_research import ProviderError
from ..providers import NoRedirect


class StreamError(ProviderError):
    def __init__(self, message, retryable=True):
        super().__init__(message)
        self.retryable = retryable


def parse_output(raw):
    if not isinstance(raw,str):raise ValueError('Expected writing text')
    text=raw.strip().lstrip('\ufeff').strip()
    fenced=re.fullmatch(r'```(?:json)?\s*\n(.*?)\n```',text,re.DOTALL|re.IGNORECASE)
    if fenced:text=fenced.group(1).strip()
    # Some providers emit literal newlines inside JSON strings. This preserves
    # their exact text; incomplete objects still fail and are never accepted.
    value=json.loads(text,strict=False)
    if not isinstance(value,dict):raise ValueError('Expected an object')
    return value


def writing_result(response, stage):
    """Validate completion and content together, inside the caller's retry loop."""
    try:
        choice=response['choices'][0]
        finish=choice.get('finish_reason')
        if finish!='stop':
            if finish=='length':
                raise StreamError('The writing reached the response limit before it finished.')
            raise StreamError('The writing provider stopped before completing the response.',retryable=finish in (None,'error'))
        result=parse_output(choice['message']['content'])
        if stage=='Review':
            if not isinstance(result.get('pass'),bool):raise ValueError('Missing review verdict')
        elif not isinstance(result.get('text'),str) or not result['text'].strip():
            raise ValueError('Missing writing')
        return result
    except StreamError:raise
    except (KeyError,IndexError,TypeError,ValueError,AttributeError):
        raise StreamError('The writing provider returned a response that could not be read.') from None


def configuration():
    if os.getenv('VULTR_INFERENCE_API_KEY'):
        return 'Vultr Serverless Inference', 'muse-glimmer-30b'
    if os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY'):
        model=os.getenv('PARAMYTH_CREATIVE_MODEL','gemini-3.5-flash-lite')
        if not re.fullmatch(r'[A-Za-z0-9._-]+',model):raise ProviderError('Invalid creative model configuration')
        return 'Gemini',model
    raise ProviderError('Connect a Gemini or Vultr key before drafting.')


def partial_string(raw):
    """Decode only complete characters, never expose a half escape or surrogate."""
    output=[];i=1
    escapes={'n':'\n','r':'\r','t':'\t','b':'\b','f':'\f','"':'"','\\':'\\','/':'/'}
    while i<len(raw):
        c=raw[i]
        if c=='"':break
        if c!='\\':output.append(c);i+=1;continue
        if i+1>=len(raw):break
        c=raw[i+1]
        if c!='u':
            if c not in escapes:break
            output.append(escapes[c]);i+=2;continue
        if i+6>len(raw):break
        try:code=int(raw[i+2:i+6],16)
        except ValueError:break
        i+=6
        if 0xD800<=code<=0xDBFF:
            if i+6>len(raw) or raw[i:i+2]!='\\u':break
            try:low=int(raw[i+2:i+6],16)
            except ValueError:break
            if not 0xDC00<=low<=0xDFFF:break
            code=0x10000+((code-0xD800)<<10)+(low-0xDC00);i+=6
        if 0xDC00<=code<=0xDFFF:break
        output.append(chr(code))
    return ''.join(output)


def preview(raw):
    """Read title/text/summary only at the JSON object's root, including partial values."""
    result={};decoder=json.JSONDecoder();i=0
    while i<len(raw) and raw[i].isspace():i+=1
    if i>=len(raw) or raw[i]!='{':return result
    i+=1
    while i<len(raw):
        while i<len(raw) and (raw[i].isspace() or raw[i]==','):i+=1
        try:key,end=decoder.raw_decode(raw,i)
        except ValueError:break
        if not isinstance(key,str):break
        i=end
        while i<len(raw) and raw[i].isspace():i+=1
        if i>=len(raw) or raw[i]!=':':break
        i+=1
        while i<len(raw) and raw[i].isspace():i+=1
        if key in ('title','text','summary') and raw[i:i+1]=='"':result[key]=partial_string(raw[i:])
        try:_,i=decoder.raw_decode(raw,i)
        except ValueError:break
    return result


def events(response):
    lines=[]
    for line in response:
        text=line.decode('utf-8').rstrip('\r\n')
        if not text:
            if lines:
                yield '\n'.join(lines);lines=[]
        elif text.startswith('data:'):lines.append(text[5:].lstrip(' '))
    if lines:yield '\n'.join(lines)


def completion(provider, model, messages, temperature, on_chunk, *, schema=None, images=()):
    if provider=='Gemini':
        url='https://generativelanguage.googleapis.com/v1beta/models/'+model+':streamGenerateContent?alt=sse'
        payload={'systemInstruction':{'parts':[{'text':messages[0]['content']}]},
                 'contents':[{'role':'user','parts':[{'text':messages[1]['content']}]}],
                 'generationConfig':{'responseMimeType':'application/json','temperature':temperature,'maxOutputTokens':12000}}
        if schema:payload['generationConfig']['responseJsonSchema']=schema
        payload['contents'][0]['parts'] += [{'inlineData':{'mimeType':i['mime'],'data':i['data']}} for i in images]
        headers={'x-goog-api-key':os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY','')}
    else:
        url='https://api.vultrinference.com/v1/chat/completions'
        payload={'model':model,'messages':messages,'response_format':{'type':'json_object'},'max_tokens':6500,'temperature':temperature,'stream':True,'stream_options':{'include_usage':True}}
        headers={'Authorization':'Bearer '+os.getenv('VULTR_INFERENCE_API_KEY','')}
    headers.update({'Content-Type':'application/json','Accept':'text/event-stream'})
    raw='';finish=None;usage={}
    try:
        request=Request(url,data=json.dumps(payload).encode(),headers=headers)
        with build_opener(NoRedirect()).open(request,timeout=180) as response:
            for data in events(response):
                if data=='[DONE]':break
                value=json.loads(data)
                if value.get('error'):raise StreamError('The writing provider stopped the stream.')
                if provider=='Gemini':
                    candidate=(value.get('candidates') or [{}])[0]
                    chunk=''.join(p.get('text','') for p in candidate.get('content',{}).get('parts',[]) if not p.get('thought'))
                    reason=candidate.get('finishReason')
                    if reason:finish='stop' if reason=='STOP' else 'length' if reason=='MAX_TOKENS' else reason
                    usage=value.get('usageMetadata') or usage
                else:
                    choice=(value.get('choices') or [{}])[0]
                    chunk=choice.get('delta',{}).get('content') or ''
                    finish=choice.get('finish_reason') or finish
                    usage=value.get('usage') or usage
                if chunk:
                    raw+=chunk
                    if len(raw)>200000:raise ProviderError('The draft exceeded the response limit.')
                    on_chunk(raw)
        if finish!='stop':raise StreamError('Drafting stopped before completion. Your partial draft is saved.',retryable=finish in (None,'length'))
        return {'choices':[{'message':{'content':raw},'finish_reason':finish}],'usage':usage}
    except HTTPError as exc:
        exc.close()
        raise StreamError(f'Writing provider HTTP {exc.code}. Check Connections if this continues.',retryable=exc.code in (408,429,500,502,503,504)) from None
    except (URLError,TimeoutError,OSError,ValueError) as exc:
        if isinstance(exc,ProviderError):raise
        raise StreamError('The writing connection stopped. Your partial draft is saved.') from None
