"""Cached SerpAPI web research for production plans, with a small allowance and key failover."""
from __future__ import annotations
import hashlib
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sqlite3
import time
from urllib.parse import urlencode, urlsplit

from .providers import ProviderError, request_json


def safe_url(value):
    try:
        u = urlsplit(str(value))
        return str(value) if u.scheme in ('https', 'http') and u.hostname and not u.username else ''
    except ValueError:
        return ''


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


class Search:
    def __init__(self, folder, keys=None, daily_limit=10, plan_limit=2):
        configured = keys if keys is not None else [search_key(), *os.getenv('SERPAPI_BACKUP_KEYS', '').split(',')]
        self.keys = list(dict.fromkeys(k.strip() for k in configured if isinstance(k, str) and k.strip()))
        self.daily_limit = min(30, max(0, int(daily_limit)))
        self.plan_limit = min(3, max(0, int(plan_limit)))
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

    def __call__(self, query, purpose='location'):
        return self.search(query, purpose)

    def search(self, query, purpose='location'):
        if not isinstance(query, str) or not query.strip():
            raise ValueError('Search query must be nonempty text')
        if not isinstance(purpose, str) or not purpose.strip() or len(purpose) > 60:
            raise ValueError('Search purpose must be text between 1 and 60 characters')
        query = ' '.join(query.split())[:240]
        purpose = purpose.strip().lower()
        # Purpose controls freshness: a day-old location cache cannot satisfy legal research.
        ident = hashlib.sha256(json.dumps([query.casefold(), purpose]).encode()).hexdigest()
        now = time.time()
        with self.connect() as c:
            row = c.execute('SELECT body FROM cache WHERE id=? AND expires>?', (ident, now)).fetchone()
        if row: return {**json.loads(row[0]), 'cached': True}
        if self.used >= self.plan_limit: raise ProviderError('Per-plan search allowance reached')
        if not self.keys: raise ProviderError('SerpAPI is not configured; add server-side search keys')
        self.used += 1
        for key in self.keys[:3]:
            if not self.reserve(key): continue
            params = {'engine':'google', 'q':query, 'api_key':key, 'hl':'en', 'num':5}
            try:
                body = request_json('https://serpapi.com/search.json?' + urlencode(params), timeout=35)
            except ProviderError as exc:
                if str(exc) in ('Provider HTTP 401', 'Provider HTTP 403', 'Provider HTTP 429'):
                    fingerprint = hashlib.sha256(key.encode()).hexdigest()[:16]
                    with self.connect() as c:
                        c.execute('INSERT OR REPLACE INTO cooldown VALUES (?,?)', (fingerprint, now + 3600))
                    continue
                raise
            if not isinstance(body, dict):
                raise ProviderError('Search provider returned invalid results')
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
            results = []
            organic = body.get('organic_results', [])
            if not isinstance(organic, list) or any(not isinstance(item, dict) for item in organic):
                raise ProviderError('Search provider returned invalid results')
            for item in organic[:5]:
                url = safe_url(item.get('link', ''))
                if url:
                    results.append({'title':str(item.get('title',''))[:300], 'url':url, 'snippet':str(item.get('snippet',''))[:1200]})
            result = {'query':query, 'purpose':purpose, 'results':results, 'retrieved_at':now, 'cached':False, 'evidence_level':'search_snippet_only'}
            with self.connect() as c:
                c.execute('INSERT OR REPLACE INTO cache VALUES (?,?,?)', (ident, now + (21600 if purpose == 'legal' else 86400), json.dumps(result)))
            return result
        raise ProviderError('Search keys unavailable or exhausted; cooldown is active. Use cached research or try later.')

