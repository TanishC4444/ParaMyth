"""Industry news: feed parsing, merging and caching from fixture XML, with no network calls."""
from pathlib import Path
import unittest
from unittest.mock import patch

from test_studio_projects import StudioTestCase, TestClient

try:
    from paramyth.studio import news
    from paramyth.studio.news import FeedError, NewsCache, merge, parse, plain
except ImportError:  # The studio is an optional extra: pip install -e '.[studio]'
    news = None
STUDIO = unittest.skipIf(news is None, 'studio extra not installed')

FIXTURES = Path(__file__).parent / 'fixtures' / 'news'
TRADE = ('trade', 'Trade Daily', 'https://trade.example', 'https://trade.example/feed/')
CRAFT = ('craft', 'Craft Notes', 'https://craft.example', 'https://craft.example/atom.xml')


def fixture(name):
    return (FIXTURES / name).read_bytes()


class Clock:
    def __init__(self):
        self.now = 1_000_000.0

    def __call__(self):
        return self.now


@STUDIO
class ParseTests(unittest.TestCase):
    def test_rss_items_are_plain_text_with_safe_links(self):
        items = parse(fixture('rss.xml'), TRADE)
        self.assertEqual([i['title'] for i in items],
                         ['Studio greenlights ‘Harbor Bell’ series', 'Writers room opens for winter slate', 'Undated festival note'])
        first = items[0]
        self.assertEqual(first['summary'], 'The eight-episode drama starts shooting in spring.')
        self.assertEqual((first['source'], first['source_id'], first['published']), ('Trade Daily', 'trade', '2026-10-23T18:30:00Z'))
        self.assertEqual(items[1]['summary'], 'Five staff writers join & the showrunner today.')
        self.assertIsNone(items[2]['published'])
        self.assertNotIn('javascript:alert(1)', [i['link'] for i in items])

    def test_atom_uses_the_alternate_link_and_normalises_dates(self):
        items = parse(fixture('atom.xml'), CRAFT)
        self.assertEqual(items[0], {'title': 'Structure before scenes', 'link': 'https://craft.example/structure-before-scenes',
                                    'source': 'Craft Notes', 'source_id': 'craft', 'published': '2026-10-24T12:00:00Z',
                                    'summary': 'Outline the turns first.'})
        self.assertEqual(items[1]['published'], '2026-10-23T18:00:00Z')

    def test_untrusted_documents_are_refused(self):
        for body in (fixture('entity.xml'), b'<html><body>Not a feed</body></html>', b'not xml at all', b'<rss><channel>'):
            with self.subTest(body=body[:30]), self.assertRaises(FeedError):
                parse(body, TRADE)

    def test_summaries_are_trimmed_on_a_word(self):
        text = plain('<p>' + 'word ' * 200 + '</p>', 40)
        self.assertLessEqual(len(text), 41)
        self.assertTrue(text.endswith('word…'))

    def test_merge_sorts_newest_first_and_drops_repeats(self):
        merged = merge([parse(fixture('rss.xml'), TRADE), parse(fixture('atom.xml'), CRAFT)])
        self.assertEqual([(i['source_id'], i['title']) for i in merged], [
            ('craft', 'Structure before scenes'),
            ('trade', 'Writers room opens for winter slate'),
            ('trade', 'Studio greenlights ‘Harbor Bell’ series'),
            ('trade', 'Undated festival note')])


@STUDIO
class FetchTests(unittest.TestCase):
    def test_oversized_feeds_are_refused(self):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def read(self, limit):
                return b'x' * limit

        with patch.object(news._opener, 'open', return_value=Response()) as opened, self.assertRaises(FeedError):
            news.fetch('https://trade.example/feed/')
        self.assertEqual(opened.call_args.kwargs['timeout'], news.TIMEOUT)

    def test_redirects_must_stay_on_https(self):
        with self.assertRaises(FeedError):
            news._HttpsOnly().redirect_request(None, None, 302, 'Found', {}, 'http://trade.example/feed/')


@STUDIO
class CacheTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.calls = []
        self.broken = set()
        self.bodies = {TRADE[3]: fixture('rss.xml'), CRAFT[3]: fixture('atom.xml')}

        def fetcher(url):
            self.calls.append(url)
            if url in self.broken:
                raise FeedError("didn't respond")
            return self.bodies[url]

        self.cache = NewsCache((TRADE, CRAFT), fetcher, self.clock)

    def test_results_are_cached_for_fifteen_minutes(self):
        self.cache.snapshot()
        self.cache.snapshot()
        self.assertEqual(len(self.calls), 2)
        self.clock.now += news.CACHE_SECONDS
        self.cache.snapshot()
        self.assertEqual(len(self.calls), 4)

    def test_one_failed_source_leaves_the_rest_and_is_named(self):
        self.broken.add(CRAFT[3])
        view = self.cache.snapshot()
        self.assertEqual({i['source_id'] for i in view['items']}, {'trade'})
        craft = next(s for s in view['sources'] if s['id'] == 'craft')
        self.assertEqual((craft['ok'], craft['error'], craft['count']), (False, "didn't respond", 0))
        self.clock.now += news.RETRY_SECONDS
        self.broken.clear()
        self.assertTrue(all(s['ok'] for s in self.cache.snapshot()['sources']))

    def test_a_source_that_goes_down_keeps_its_last_headlines(self):
        self.cache.snapshot()
        self.broken.add(TRADE[3])
        self.clock.now += news.CACHE_SECONDS
        view = self.cache.snapshot()
        trade = next(s for s in view['sources'] if s['id'] == 'trade')
        self.assertFalse(trade['ok'])
        self.assertEqual(trade['count'], 3)
        self.assertIn('trade', {i['source_id'] for i in view['items']})

    def test_forced_refresh_is_rate_limited(self):
        self.cache.snapshot()
        self.cache.snapshot(force=True)
        self.cache.snapshot(force=True)
        self.assertEqual(len(self.calls), 4)
        self.clock.now += news.MIN_REFRESH_SECONDS
        self.cache.snapshot(force=True)
        self.assertEqual(len(self.calls), 6)


class NewsRouteTests(StudioTestCase):
    def setUp(self):
        super().setUp()
        self.urls = []

        def fetcher(url):
            self.urls.append(url)
            return fixture('rss.xml')

        cache = patch.object(news, 'news_cache', NewsCache((TRADE,), fetcher, Clock()))
        cache.start()
        self.addCleanup(cache.stop)

    def test_reads_are_local_and_only_fetch_configured_feeds(self):
        view = self.client.get('/api/ui/news', params={'url': 'http://169.254.169.254/'}).json()
        self.assertEqual(len(view['items']), 3)
        self.assertEqual(view['sources'][0]['name'], 'Trade Daily')
        self.assertEqual(self.urls, [TRADE[3]])
        remote = TestClient(self.app, base_url='http://studio.example.com')
        self.assertEqual(remote.get('/api/ui/news').status_code, 403)

    def test_refresh_needs_the_page_token(self):
        self.assertEqual(self.client.post('/api/ui/news/refresh').status_code, 403)
        refreshed = self.client.post('/api/ui/news/refresh', headers={'X-ParaMyth-Token': self.token})
        self.assertEqual(refreshed.status_code, 200)
        self.assertEqual(len(refreshed.json()['items']), 3)

    def test_feed_list_is_https_and_unique(self):
        self.assertEqual(len({f[0] for f in news.FEEDS}), len(news.FEEDS))
        self.assertTrue(all(f[3].startswith('https://') for f in news.FEEDS))


if __name__ == '__main__':
    unittest.main()
