"""Explicit, account-attributed community snapshots, separate from private projects."""
from contextlib import contextmanager, closing
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
import re
import secrets
import sqlite3
from uuid import UUID

from fastapi import APIRouter, Body, HTTPException, Request

from .deps import LOCAL, WRITE

router = APIRouter(prefix='/api/ui/discovery', tags=['community discovery'], dependencies=LOCAL)
KINDS = ('project', 'story', 'character')


def actor(request):
    if getattr(request.app.state, 'account_workspaces', False):
        from .accounts import user
        account = user(request)
        return str(account['id']), account['display_name']
    return 'local', 'Local creator'


@contextmanager
def database(request):
    root = Path(request.app.state.shared_root) / '.community'
    root.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(root / 'discovery.sqlite', timeout=15)) as conn, conn:
        conn.row_factory = sqlite3.Row
        conn.execute('''CREATE TABLE IF NOT EXISTS posts (
            id TEXT PRIMARY KEY, author_id TEXT NOT NULL, author_name TEXT NOT NULL,
            kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, tags TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
            published INTEGER NOT NULL DEFAULT 1, client_id TEXT NOT NULL,
            UNIQUE(author_id, client_id))''')
        conn.execute('CREATE INDEX IF NOT EXISTS posts_feed ON posts(published, created_at DESC, id DESC)')
        conn.execute('''CREATE TABLE IF NOT EXISTS reports (
            post_id TEXT NOT NULL, author_id TEXT NOT NULL, reason TEXT NOT NULL,
            created_at TEXT NOT NULL, PRIMARY KEY(post_id, author_id))''')
        yield conn


def fields(data):
    kind, title, body = data.get('kind'), data.get('title'), data.get('body')
    if kind not in KINDS:
        raise ValueError('Choose project, story or character')
    if not isinstance(title, str) or not 1 <= len(title.strip()) <= 150:
        raise ValueError('Give your post a title under 150 characters')
    if not isinstance(body, str) or not 10 <= len(body.strip()) <= 12000:
        raise ValueError('Write between 10 and 12,000 characters')
    tags = data.get('tags', [])
    if not isinstance(tags, list) or len(tags) > 5 or any(not isinstance(tag, str) or not 1 <= len(tag.strip()) <= 30 for tag in tags):
        raise ValueError('Use up to five short tags')
    return kind, title.strip(), body.strip(), json.dumps(list(dict.fromkeys(tag.strip() for tag in tags)))


def public(row, viewer):
    return {key: row[key] for key in ('id', 'author_name', 'kind', 'title', 'body', 'created_at', 'updated_at', 'revision')} | {
        'tags': json.loads(row['tags']), 'mine': row['author_id'] == viewer, 'published': bool(row['published'])}


@router.get('')
def feed(request: Request, q: str = '', kind: str = '', mine: bool = False, before: str = ''):
    viewer, _ = actor(request)
    if len(q) > 120 or kind and kind not in KINDS:
        raise ValueError('Use a shorter search and a supported post type')
    clauses, values = ['p.author_id=?' if mine else 'p.published=1'], [viewer] if mine else []
    clauses.append('NOT EXISTS (SELECT 1 FROM reports r WHERE r.post_id=p.id AND r.author_id=?)')
    values.append(viewer)
    if kind:
        clauses.append('p.kind=?'); values.append(kind)
    if q.strip():
        clauses.append("(p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\' OR p.tags LIKE ? ESCAPE '\\')")
        term = '%' + re.sub(r'([%_\\])', r'\\\1', q.strip()) + '%'
        values.extend([term] * 3)
    with database(request) as conn:
        if before:
            cursor = conn.execute('SELECT created_at,id FROM posts WHERE id=?', (before,)).fetchone()
            if not cursor:
                raise HTTPException(400, 'Refresh discovery before loading more')
            clauses.append('(p.created_at < ? OR (p.created_at = ? AND p.id < ?))')
            values.extend([cursor['created_at'], cursor['created_at'], cursor['id']])
        rows = conn.execute('SELECT p.* FROM posts p WHERE ' + ' AND '.join(clauses) + ' ORDER BY p.created_at DESC,p.id DESC LIMIT 21', values).fetchall()
    return {'posts': [public(row, viewer) for row in rows[:20]], 'next': rows[19]['id'] if len(rows) > 20 else ''}


@router.get('/{ident}')
def read_post(ident: str, request: Request):
    viewer, _ = actor(request)
    with database(request) as conn:
        row = conn.execute('SELECT * FROM posts WHERE id=? AND (published=1 OR author_id=?)', (ident, viewer)).fetchone()
    if not row:
        raise HTTPException(404, 'This post is no longer available')
    return public(row, viewer)


@router.post('', dependencies=WRITE, status_code=201)
def publish(request: Request, data: dict = Body(...)):
    if data.get('confirm_public') is not True:
        raise ValueError('Confirm that you want to share this text with other members')
    kind, title, body, tags = fields(data)
    try:
        client_id = str(UUID(str(data.get('submission_id', ''))))
    except ValueError:
        raise ValueError('Refresh the post form before publishing') from None
    author, name = actor(request)
    now = datetime.now(timezone.utc).isoformat()
    with database(request) as conn:
        conn.execute('BEGIN IMMEDIATE')
        previous = conn.execute('SELECT * FROM posts WHERE author_id=? AND client_id=?', (author, client_id)).fetchone()
        if previous:
            return public(previous, author)
        since = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        if conn.execute('SELECT count(*) FROM posts WHERE author_id=? AND created_at>?', (author, since)).fetchone()[0] >= 20:
            raise HTTPException(429, 'You have shared several posts recently. Try again in an hour.')
        ident = secrets.token_hex(12)
        conn.execute('INSERT INTO posts(id,author_id,author_name,kind,title,body,tags,created_at,updated_at,client_id) VALUES(?,?,?,?,?,?,?,?,?,?)',
                     (ident, author, name, kind, title, body, tags, now, now, client_id))
        return public(conn.execute('SELECT * FROM posts WHERE id=?', (ident,)).fetchone(), author)


@router.patch('/{ident}', dependencies=WRITE)
def edit_post(ident: str, request: Request, data: dict = Body(...)):
    author, name = actor(request)
    kind, title, body, tags = fields(data)
    if not isinstance(data.get('published', True), bool):
        raise ValueError('Choose whether to publish this post')
    if data.get('published', True) and data.get('confirm_public') is not True:
        raise ValueError('Confirm that you want to share this text with other members')
    with database(request) as conn:
        result = conn.execute('UPDATE posts SET kind=?,title=?,body=?,tags=?,author_name=?,published=?,updated_at=?,revision=revision+1 WHERE id=? AND author_id=? AND revision=?',
                              (kind, title, body, tags, name, int(data.get('published', True)), datetime.now(timezone.utc).isoformat(), ident, author, data.get('revision')))
        if result.rowcount != 1:
            raise HTTPException(409, 'This post changed or is not yours. Reload it before saving.')
        return public(conn.execute('SELECT * FROM posts WHERE id=?', (ident,)).fetchone(), author)


@router.post('/{ident}/report', dependencies=WRITE)
def report(ident: str, request: Request, data: dict = Body(...)):
    author, _ = actor(request)
    reason = data.get('reason', '')
    if reason not in ('Spam', 'Harassment', 'Rights concern', 'Other'):
        raise ValueError('Choose a reason for reporting this post')
    with database(request) as conn:
        row = conn.execute('SELECT author_id FROM posts WHERE id=? AND published=1', (ident,)).fetchone()
        if not row or row['author_id'] == author:
            raise HTTPException(404, 'Post not available for reporting')
        conn.execute('INSERT OR IGNORE INTO reports VALUES(?,?,?,?)', (ident, author, reason, datetime.now(timezone.utc).isoformat()))
    return {'reported': True}
