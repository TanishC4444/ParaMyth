"""Explicit HTTPS chat-completions transport; no implicit provider or fallback."""
import json
import os
import socket
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from .contracts import ContractError


class ProviderError(RuntimeError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # Never forward credentials to a redirected endpoint.


SCHEMAS = {
    'architect': 'JSON object: title, threads (string array), scenes. Each scene has id ch01-sc01 etc in reading order, chapter, pov (character ID), participants (ID array), location, time, goal, obstacle, intended_change. Exactly the requested chapters * scenes_per_chapter.',
    'memory': 'JSON object: memories array. Each item: kind (event/belief/claim/resource/relationship/thread), text, evidence (exact prose quote at least 12 characters), known_by (character IDs or public). Beliefs also require holder. Extract only supported facts; never broaden witness knowledge.',
}
REVIEW = ('JSON object: pass boolean, issues array (severity blocking/advisory, category, quote exactly from prose, problem, fix), '
          'checks array. Each check: category, reason, quote exactly from prose. Cover continuity, viewpoint and scene_change for story/chapter; evidence and knowledge for memory. '
          'Reject cast identity mistakes, unsupported facts and repeated discoveries. Never approve by default.')


def instructions(role):
    if role in SCHEMAS:
        return SCHEMAS[role]
    if role.endswith('quality'):
        return REVIEW
    return {'character': 'Propose a brief action and motive using only your own identity and visible facts. Proposals are not canon.',
            'director': 'Give a concise scene direction with competing tactics, an alternative and a concrete consequence. Do not invent accepted events.',
            'writer': 'Write only complete scene prose at the requested length. Respect POV knowledge, cast identities and accepted facts. Advance the scene rather than repeat prior discoveries.',
            'humanizer': 'Return complete revised prose only. Repair structural repetition, unclear causality and generic phrasing while preserving accepted events and viewpoint.'}[role]


class ChatTransport:
    def __init__(self, base_url, model, key, *, timeout=60, retries=2, cooldown=30,
                 max_tokens=2048, opener=None, sleep=time.sleep, clock=time.monotonic):
        url = urlsplit(base_url)
        if (url.scheme != 'https' or not url.hostname or url.username or url.password
                or url.query or url.fragment):
            raise ValueError('Provider URL must be HTTPS without credentials, query or fragment')
        if not model or not key:
            raise ValueError('Explicit provider model and API key are required')
        if not 1 <= timeout <= 120 or not 0 <= retries <= 3 or not 1 <= max_tokens <= 8192:
            raise ValueError('Invalid provider limits')
        self.url, self.model, self.key = base_url.rstrip('/') + '/chat/completions', model, key
        self.timeout, self.retries, self.cooldown, self.max_tokens = timeout, retries, cooldown, max_tokens
        self.opener = opener or build_opener(NoRedirect())
        self.sleep, self.clock, self.blocked_until = sleep, clock, 0
        self.events = []

    @classmethod
    def from_env(cls):
        return cls(os.environ.get('PARAMYTH_BASE_URL', ''), os.environ.get('PARAMYTH_MODEL', ''),
                   os.environ.get('PARAMYTH_API_KEY', ''))

    @property
    def identity(self):
        return {'endpoint': self.url, 'model': self.model, 'max_tokens': self.max_tokens}

    def __call__(self, role, packet, req):
        if self.clock() < self.blocked_until:
            raise ProviderError('Provider cooldown active; resume later')
        body = {'model': self.model, 'max_completion_tokens': self.max_tokens,
                'messages': [{'role': 'system', 'content': instructions(role)},
                             {'role': 'user', 'content': json.dumps(packet, ensure_ascii=False)}]}
        encoded = json.dumps(body).encode()
        for attempt in range(self.retries + 1):
            started = self.clock()
            event = {'role': role, 'attempt': attempt + 1, 'model': self.model,
                     'usage': None, 'status': 'error'}
            try:
                request = Request(self.url, data=encoded,
                                  headers={'Authorization': 'Bearer ' + self.key, 'Content-Type': 'application/json'})
                with self.opener.open(request, timeout=self.timeout) as response:
                    raw = response.read(2_000_001)
                if len(raw) > 2_000_000:
                    raise ProviderError('Provider response exceeds size limit')
                value = json.loads(raw)
                event['usage'] = value.get('usage')
                choice = value['choices'][0]
                event['finish_reason'] = choice.get('finish_reason')
                event['status'] = 'returned'
                return {'text': choice['message'].get('content'), 'finish_reason': choice.get('finish_reason'),
                        'usage': value.get('usage'), 'model': value.get('model', self.model)}
            except HTTPError as exc:
                event['http_status'] = exc.code
                # Provider bodies may contain sensitive request details; never persist them.
                if exc.code in (401, 403) or exc.code == 429:
                    retry_after = exc.headers.get('Retry-After', '') if exc.headers else ''
                    wait = max(self.cooldown, float(retry_after) if retry_after.isdigit() else 0)
                    self.blocked_until = self.clock() + wait
                    raise ProviderError('Provider HTTP %d; cooldown active' % exc.code) from None
                if exc.code not in (500, 502, 503, 504) or attempt == self.retries:
                    raise ProviderError('Provider HTTP %d' % exc.code) from None
                retry_after = exc.headers.get('Retry-After') if exc.headers else None
                delay = max(2 ** attempt, float(retry_after) if retry_after and retry_after.isdigit() else 0)
                if delay > 60:
                    self.blocked_until = self.clock() + delay
                    raise ProviderError('Provider retry delay exceeds call budget; resume later') from None
                self.sleep(delay)
            except (URLError, TimeoutError, socket.timeout):
                # A lost response may already have consumed usage. Avoid duplicate generation.
                raise ProviderError('Provider connection failed or timed out; usage unknown') from None
            except (KeyError, IndexError, TypeError, ValueError):
                raise ContractError('Malformed provider response') from None
            finally:
                event['elapsed_seconds'] = self.clock() - started
                self.events.append(event)
