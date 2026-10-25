"""Browser sessions shared by account pages, workspace APIs and private media."""
import secrets

from fastapi import HTTPException

from .studio_db import connection
from .studio_security import current_user, digest

COOKIE = 'paramyth_session'
SESSION_SECONDS = 7 * 24 * 60 * 60


def authorization(request):
    # An explicitly supplied bearer token must never fall back to a cookie.
    header = request.headers.get('authorization')
    return header if header is not None else 'Bearer ' + request.cookies.get(COOKIE, '')


def user(request):
    if not hasattr(request.state, 'account'):
        with connection() as conn:
            request.state.account = current_user(conn, authorization(request))
    return request.state.account


def csrf(request):
    # Tied to this login, so another login (even for the same user) cannot reuse it.
    return digest('workspace-csrf:' + authorization(request))


def origin(request):
    return getattr(request.app.state, 'public_origin', '') or str(request.base_url).rstrip('/')


def same_origin(request):
    supplied = request.headers.get('origin')
    if (supplied and supplied != origin(request)) or request.headers.get('sec-fetch-site') == 'cross-site':
        raise HTTPException(403, 'Origin rejected')


def set_session(response, request, session):
    response.set_cookie(COOKIE, session['token'], max_age=SESSION_SECONDS,
                        httponly=True, secure=origin(request).startswith('https://'),
                        samesite='lax', path='/')
    response.headers['Cache-Control'] = 'no-store'


def clear_session(response):
    response.delete_cookie(COOKIE, path='/', httponly=True, samesite='lax')
    for name in ('paramyth_project', 'pm_pipeline_project'):
        response.delete_cookie(name, path='/')


def require_csrf(request):
    same_origin(request)
    if not secrets.compare_digest(request.headers.get('X-ParaMyth-Token', ''), csrf(request)):
        raise HTTPException(403, 'Refresh this page before saving changes')
