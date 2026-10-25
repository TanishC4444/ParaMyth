"""Industry news: film, TV and screenwriting headlines from a fixed list of public feeds.

Feeds are fetched on the server, never from a URL a request supplies, and cached so the
page doesn't hit the sources on every load. Feed XML is untrusted: documents are capped
in size, entity declarations are refused, links must be http(s) and summaries are plain text.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from html.parser import HTMLParser
import re
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener
import xml.etree.ElementTree as ET

from fastapi import APIRouter

from .deps import LOCAL, WRITE

# Edit this list to change the sources. Each entry: (id, name, site, feed URL).
FEEDS = (
    ('deadline', 'Deadline', 'https://deadline.com', 'https://deadline.com/feed/'),
    ('variety', 'Variety', 'https://variety.com', 'https://variety.com/feed/'),
    ('thr', 'The Hollywood Reporter', 'https://www.hollywoodreporter.com', 'https://www.hollywoodreporter.com/feed/'),
    ('indiewire', 'IndieWire', 'https://www.indiewire.com', 'https://www.indiewire.com/feed/'),
    ('slashfilm', '/Film', 'https://www.slashfilm.com', 'https://www.slashfilm.com/feed/'),
    ('nofilmschool', 'No Film School', 'https://nofilmschool.com', 'https://nofilmschool.com/rss.xml'),
    ('gointothestory', 'Go Into The Story', 'https://gointothestory.blcklst.com', 'https://gointothestory.blcklst.com/feed'),
    ('scriptmag', 'Script Magazine', 'https://www.scriptmag.com', 'https://www.scriptmag.com/feed'),
)

CACHE_SECONDS = 15 * 60
RETRY_SECONDS = 2 * 60  # A failed source is retried sooner than a working one.
MIN_REFRESH_SECONDS = 30  # A forced refresh never re-fetches more often than this.
TIMEOUT = 8
MAX_BYTES = 3 * 1024 * 1024
ITEMS_PER_FEED = 25
SUMMARY_CHARS = 280
USER_AGENT = 'ParaMyth-Studio/0.1 (industry news reader)'

router = APIRouter(prefix='/api/ui', tags=['industry news'], dependencies=LOCAL)


class FeedError(Exception):
    """A source couldn't be read. The message is safe to show in the studio."""


class _HttpsOnly(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlsplit(newurl).scheme != 'https':
            raise FeedError("redirected somewhere we don't follow")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_opener = build_opener(_HttpsOnly)


def fetch(url):
    """Download one configured feed with a timeout and a size cap."""
    try:
        with _opener.open(Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml'}), timeout=TIMEOUT) as response:
            body = response.read(MAX_BYTES + 1)
    except HTTPError as exc:
        raise FeedError(f'responded with HTTP {exc.code}') from None
    except (URLError, TimeoutError, OSError):
        raise FeedError("didn't respond") from None
    if len(body) > MAX_BYTES:
        raise FeedError('sent a feed that was too large')
    return body


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
        elif tag in ('p', 'br', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'td', 'blockquote'):
            self.parts.append(' ')

    def handle_endtag(self, tag):
        if tag in ('script', 'style') and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def plain(markup, limit=None):
    """Feed text as plain text: tags removed, entities decoded, whitespace collapsed."""
    parser = _Text()
    parser.feed(markup or '')
    parser.close()
    text = re.sub(r'\s+', ' ', unescape(''.join(parser.parts))).strip()
    # WordPress feeds end summaries with a "The post X appeared first on Y." footer.
    text = re.sub(r'\s*The post .{1,300} appeared first on .{1,120}\.$', '', text)
    if limit and len(text) > limit:
        text = text[:limit].rsplit(' ', 1)[0].rstrip(' ,.;:') + '…'
    return text


def _name(element):
    return element.tag.rsplit('}', 1)[-1].lower()


def _child(element, *names):
    """Text of the first child with one of these local names, in order of preference."""
    for name in names:
        for child in element:
            if _name(child) == name and (child.text or '').strip():
                return child.text.strip()
    return ''


def _atom_link(entry):
    links = [c for c in entry if _name(c) == 'link' and c.get('href')]
    for link in links:
        if link.get('rel', 'alternate') == 'alternate':
            return link.get('href').strip()
    return links[0].get('href').strip() if links else ''


def _date(value):
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        try:
            parsed = datetime.fromisoformat(value.strip().replace('Z', '+00:00'))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _web_link(value):
    parts = urlsplit(value.strip()) if value else None
    return value.strip() if parts and parts.scheme in ('http', 'https') and parts.netloc else ''


def parse(body, source):
    """Read RSS 2.0, RSS 1.0 or Atom into plain items. `source` is a FEEDS entry."""
    if b'<!ENTITY' in body[:65536].upper():
        raise FeedError("sent a feed we couldn't read")
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        raise FeedError("sent a feed we couldn't read") from None
    ident, name = source[0], source[1]
    items = []
    for element in root.iter():
        kind = _name(element)
        if kind not in ('item', 'entry'):
            continue
        atom = kind == 'entry'
        title = plain(_child(element, 'title'), 300)
        link = _web_link(_atom_link(element) if atom else (_child(element, 'link') or _child(element, 'guid')))
        if not title or not link:
            continue
        summary = _child(element, 'summary', 'content') if atom else _child(element, 'description', 'encoded')
        stamp = _date(_child(element, 'published', 'updated') if atom else _child(element, 'pubdate', 'date'))
        items.append({'title': title, 'link': link, 'source': name, 'source_id': ident,
                      'published': stamp.isoformat().replace('+00:00', 'Z') if stamp else None,
                      'summary': plain(summary, SUMMARY_CHARS)})
        if len(items) >= ITEMS_PER_FEED:
            break
    if not items and not any(_name(e) in ('channel', 'feed', 'rdf') for e in root.iter()):
        raise FeedError("sent a feed we couldn't read")
    return items


_TRACKING = re.compile(r'^(utm_|fbclid$|gclid$|mc_)')


def _link_key(link):
    parts = urlsplit(link)
    query = urlencode([(k, v) for k, v in parse_qsl(parts.query) if not _TRACKING.match(k)])
    host = parts.netloc.lower().removeprefix('www.')
    return urlunsplit(('', host, parts.path.rstrip('/'), query, ''))


def _title_key(title):
    return re.sub(r'[\W_]+', ' ', title.lower()).strip()


def merge(groups):
    """Newest first across sources, with repeats (same link or same headline) removed."""
    items = sorted((item for group in groups for item in group),
                   key=lambda item: item['published'] or '', reverse=True)
    seen, merged = set(), []
    for item in items:
        keys = {('link', _link_key(item['link'])), ('title', _title_key(item['title']))}
        if keys & seen:
            continue
        seen |= keys
        merged.append(item)
    return merged


class NewsCache:
    """Per-source cache. A failed source keeps its last good headlines and says it's unavailable."""

    def __init__(self, feeds=FEEDS, fetcher=fetch, clock=time.time):
        self.feeds, self.fetcher, self.clock = feeds, fetcher, clock
        self.entries = {}
        self.lock = threading.Lock()
        self.forced_at = 0.0

    def _load(self, source):
        now = self.clock()
        previous = self.entries.get(source[0], {})
        try:
            return {'items': parse(self.fetcher(source[3]), source), 'error': None, 'checked': now, 'updated': now}
        except FeedError as exc:
            return {'items': previous.get('items', []), 'error': str(exc), 'checked': now, 'updated': previous.get('updated')}

    def _due(self, source, now):
        entry = self.entries.get(source[0])
        if not entry:
            return True
        return now - entry['checked'] >= (RETRY_SECONDS if entry['error'] else CACHE_SECONDS)

    def snapshot(self, force=False):
        with self.lock:
            now = self.clock()
            if force and now - self.forced_at >= MIN_REFRESH_SECONDS:
                self.forced_at = now
                due = list(self.feeds)
            else:
                due = [source for source in self.feeds if self._due(source, now)]
            if due:
                with ThreadPoolExecutor(max_workers=len(due)) as pool:
                    for source, entry in zip(due, pool.map(self._load, due)):
                        self.entries[source[0]] = entry
            return self._view()

    def _view(self):
        stamp = lambda value: datetime.fromtimestamp(value, timezone.utc).isoformat().replace('+00:00', 'Z') if value else None
        sources = []
        for ident, name, site, _ in self.feeds:
            entry = self.entries[ident]
            sources.append({'id': ident, 'name': name, 'site': site, 'ok': entry['error'] is None,
                            'error': entry['error'], 'count': len(entry['items']), 'updated': stamp(entry['updated'])})
        checked = min(self.entries[s[0]]['checked'] for s in self.feeds) if self.feeds else self.clock()
        return {'items': merge(self.entries[s[0]]['items'] for s in self.feeds),
                'sources': sources, 'checked': stamp(checked), 'cache_seconds': CACHE_SECONDS}


news_cache = NewsCache()


@router.get('/news')
def news():
    return news_cache.snapshot()


@router.post('/news/refresh', dependencies=WRITE)
def refresh_news():
    return news_cache.snapshot(force=True)
