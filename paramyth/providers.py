"""Bounded JSON provider requests with redacted errors and no automatic retries."""
import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class ProviderError(ValueError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Do not forward authorization to another origin or repeat a paid POST.
        return None


def request_json(url, payload=None, headers=None, timeout=60, *, max_bytes=1024 * 1024):
    parts = urlsplit(url)
    if parts.scheme != 'https' or not parts.hostname or parts.username or parts.password:
        raise ValueError('Provider URL must use HTTPS without embedded credentials')
    data = json.dumps(payload).encode('utf-8') if payload is not None else None
    request = Request(url, data=data, headers=headers or {})
    try:
        with build_opener(NoRedirect()).open(request, timeout=timeout) as response:
            body = response.read(max_bytes + 1)
        if len(body) > max_bytes:
            raise ProviderError('Provider response exceeded the size limit')
        result = json.loads(body)
        if not isinstance(result, dict):
            raise ProviderError('Provider returned an invalid JSON object')
        return result
    except HTTPError as exc:
        code = exc.code
        exc.close()
        raise ProviderError(f'Provider HTTP {code}') from None
    except ProviderError:
        raise
    except (URLError, TimeoutError, OSError, ValueError):
        raise ProviderError('Provider request failed or returned invalid JSON') from None
