"""Vultr Serverless Inference: JSON chat completions, streamed drafts and partial previews."""
import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener

from .providers import NoRedirect, ProviderError, request_json

BASE = 'https://api.vultrinference.com/v1'
CHAT_MODEL = 'muse-glimmer-30b'
PROVIDER = 'Vultr Serverless Inference'
MAX_STREAM_CHARS = 200_000


def key():
    return os.getenv('VULTR_INFERENCE_API_KEY', '').strip()


def require_key():
    value = key()
    if not value:
        raise ProviderError('Set VULTR_INFERENCE_API_KEY in the server environment')
    return value


def headers(**extra):
    return {'Authorization': 'Bearer ' + require_key(), 'Content-Type': 'application/json', **extra}


def chat(messages, *, temperature=0.2, max_tokens=6500, timeout=180, model=CHAT_MODEL):
    """One JSON-mode completion. Returns the parsed object and the provider's usage."""
    response = request_json(BASE + '/chat/completions',
        {'model': model, 'messages': messages, 'response_format': {'type': 'json_object'},
         'max_tokens': max_tokens, 'temperature': temperature},
        headers=headers(), timeout=timeout, max_bytes=4 * 1024 * 1024)
    return parse(response), response.get('usage', {})


def parse(response):
    try:
        choice = response['choices'][0]
        if choice.get('finish_reason') == 'length':
            raise ValueError
        result = json.loads(choice['message']['content'])
        if not isinstance(result, dict):
            raise ValueError
        return result
    except (KeyError, IndexError, TypeError, ValueError):
        raise ProviderError('The writing provider returned incomplete output; no automatic retry was made') from None


def events(lines):
    """Yield server-sent event payloads from an iterable of raw lines."""
    data = []
    for line in lines:
        text = line.decode('utf-8').rstrip('\r\n')
        if not text:
            if data:
                yield '\n'.join(data)
                data = []
        elif text.startswith('data:'):
            data.append(text[5:].lstrip(' '))
    if data:
        yield '\n'.join(data)


def stream_chat(messages, on_chunk, *, temperature=0.6, max_tokens=6500, timeout=180, model=CHAT_MODEL):
    """Stream a JSON-mode completion, calling on_chunk with the text received so far."""
    payload = {'model': model, 'messages': messages, 'response_format': {'type': 'json_object'},
               'max_tokens': max_tokens, 'temperature': temperature, 'stream': True,
               'stream_options': {'include_usage': True}}
    request = Request(BASE + '/chat/completions', data=json.dumps(payload).encode('utf-8'),
                      headers=headers(Accept='text/event-stream'))
    raw, finish, usage = '', None, {}
    try:
        with build_opener(NoRedirect()).open(request, timeout=timeout) as response:
            for data in events(response):
                if data == '[DONE]':
                    break
                value = json.loads(data)
                if value.get('error'):
                    raise ProviderError('The writing provider stopped the stream')
                choice = (value.get('choices') or [{}])[0]
                chunk = choice.get('delta', {}).get('content') or ''
                finish = choice.get('finish_reason') or finish
                usage = value.get('usage') or usage
                if chunk:
                    raw += chunk
                    if len(raw) > MAX_STREAM_CHARS:
                        raise ProviderError('The draft exceeded the response limit')
                    on_chunk(raw)
    except HTTPError as exc:
        code = exc.code
        exc.close()
        raise ProviderError(f'Writing provider HTTP {code}. Your partial draft is saved') from None
    except ProviderError:
        raise
    except (URLError, TimeoutError, OSError, ValueError):
        raise ProviderError('The writing connection stopped. Your partial draft is saved; no automatic retry was made') from None
    if finish != 'stop':
        raise ProviderError('Drafting stopped before completion. Your partial draft is saved; no automatic retry was made')
    return {'choices': [{'message': {'content': raw}, 'finish_reason': finish}], 'usage': usage}


def partial_string(raw):
    """Decode a JSON string prefix, never exposing a half escape or lone surrogate."""
    output, i = [], 1
    escapes = {'n': '\n', 'r': '\r', 't': '\t', 'b': '\b', 'f': '\f', '"': '"', '\\': '\\', '/': '/'}
    while i < len(raw):
        c = raw[i]
        if c == '"':
            break
        if c != '\\':
            output.append(c)
            i += 1
            continue
        if i + 1 >= len(raw):
            break
        c = raw[i + 1]
        if c != 'u':
            if c not in escapes:
                break
            output.append(escapes[c])
            i += 2
            continue
        if i + 6 > len(raw):
            break
        try:
            code = int(raw[i + 2:i + 6], 16)
        except ValueError:
            break
        i += 6
        if 0xD800 <= code <= 0xDBFF:
            if i + 6 > len(raw) or raw[i:i + 2] != '\\u':
                break
            try:
                low = int(raw[i + 2:i + 6], 16)
            except ValueError:
                break
            if not 0xDC00 <= low <= 0xDFFF:
                break
            code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)
            i += 6
        if 0xDC00 <= code <= 0xDFFF:
            break
        output.append(chr(code))
    return ''.join(output)


def preview(raw):
    """Read title, text and summary at the root of a partial JSON object."""
    result, decoder, i = {}, json.JSONDecoder(), 0
    while i < len(raw) and raw[i].isspace():
        i += 1
    if i >= len(raw) or raw[i] != '{':
        return result
    i += 1
    while i < len(raw):
        while i < len(raw) and (raw[i].isspace() or raw[i] == ','):
            i += 1
        try:
            name, i = decoder.raw_decode(raw, i)
        except ValueError:
            break
        if not isinstance(name, str):
            break
        while i < len(raw) and raw[i].isspace():
            i += 1
        if i >= len(raw) or raw[i] != ':':
            break
        i += 1
        while i < len(raw) and raw[i].isspace():
            i += 1
        if name in ('title', 'text', 'summary') and raw[i:i + 1] == '"':
            result[name] = partial_string(raw[i:])
        try:
            _, i = decoder.raw_decode(raw, i)
        except ValueError:
            break
    return result
