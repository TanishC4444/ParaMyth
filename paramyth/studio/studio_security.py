"""Password hashing and opaque, revocable account sessions."""
import hashlib
import hmac
import secrets
from threading import BoundedSemaphore

from fastapi import HTTPException

from .studio_db import connection

_hash_slots = BoundedSemaphore(4)


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def password_hash(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    with _hash_slots:
        value = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=32768,
                               r=8, p=3, maxmem=64 * 1024 * 1024).hex()
    return f'scrypt-32768-8-3${salt}${value}'


def password_matches(password: str, encoded: str) -> bool:
    try:
        algorithm, salt, _ = encoded.split('$')
        return algorithm == 'scrypt-32768-8-3' and hmac.compare_digest(password_hash(password, salt), encoded)
    except (ValueError, TypeError):
        return False


# Unknown-account login pays the same hashing cost as a real account.
DUMMY_HASH = password_hash(secrets.token_urlsafe(32))


def rate_limit(action: str, identity: str, maximum: int):
    # Separate committed transaction: rejected logins must still count across workers/restarts.
    with connection() as conn:
        conn.execute('DELETE FROM paramyth.auth_limits WHERE resets_at < now()')
        row = conn.execute('''INSERT INTO paramyth.auth_limits(bucket, attempts, resets_at)
            VALUES (%s, 1, now() + interval '15 minutes')
            ON CONFLICT (bucket) DO UPDATE SET attempts = paramyth.auth_limits.attempts + 1
            RETURNING attempts''', (digest(action + ':' + identity),)).fetchone()
    if row['attempts'] > maximum:
        raise HTTPException(429, 'Too many attempts. Try again in 15 minutes.', headers={'Retry-After': '900'})


def new_session(conn, user):
    token = 'pm_' + secrets.token_urlsafe(32)
    conn.execute('DELETE FROM paramyth.sessions WHERE expires_at <= now()')
    session = conn.execute('''INSERT INTO paramyth.sessions(token_hash, user_id, expires_at)
        VALUES (%s, %s, now() + interval '7 days') RETURNING expires_at''',
        (digest(token), user['id'])).fetchone()
    return {'token': token, 'expires_at': session['expires_at'], 'user': user}


def current_user(conn, authorization):
    scheme, _, token = (authorization or '').partition(' ')
    if scheme.lower() != 'bearer' or not token.startswith('pm_') or len(token) > 100:
        raise HTTPException(401, 'Sign in to your studio account')
    user = conn.execute('''SELECT u.id, u.email, u.display_name FROM paramyth.sessions s
        JOIN paramyth.users u ON u.id = s.user_id
        WHERE s.token_hash = %s AND s.expires_at > now()''', (digest(token),)).fetchone()
    if not user:
        raise HTTPException(401, 'Your session has expired. Sign in again.')
    return user
