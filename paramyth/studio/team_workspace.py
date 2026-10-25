"""Team-owned authoring files, with account-owned selection and Calendar access."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import secrets
import shutil
import time
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Request

from ..storage import load, save
from . import accounts
from .deps import get_runtime, local, write
from .runtime import ACTIVE, now
from .studio_db import connection
from .studios import access

router = APIRouter(prefix='/api/ui', tags=['shared project workflow'], dependencies=[Depends(local)])


def authorize_workspace(request, account):
    selected = request.query_params.get('studio_id')
    if not selected:
        return None
    try:
        selected = UUID(selected)
    except ValueError:
        raise HTTPException(400, 'Invalid team workspace') from None
    with connection() as conn:
        studio = access(conn, account, selected)
    if (request.method not in ('GET', 'HEAD', 'OPTIONS')
            and request.url.path != '/api/studio/project/select'
            and studio['role'] not in ('owner', 'admin', 'editor')):
        raise HTTPException(403, 'You have view-only access to this team workspace')
    return studio


class StudioRuntime:
    """Share project files/jobs; never share a member's private Calendar or selection."""
    def __init__(self, shared, personal, studio):
        self.shared, self.personal, self.studio = shared, personal, studio
        self.preferences = personal.root / '.private' / ('studio-' + str(studio['id']) + '.json')

    def __getattr__(self, name):
        return getattr(self.shared, name)

    @property
    def google(self):
        return self.personal.google

    @property
    def oauth(self):
        return self.personal.oauth

    @property
    def selected(self):
        return load(self.preferences).get('project_id') if self.preferences.is_file() else None

    def select(self, ident):
        self.shared.folder(ident)
        with self.guard:
            save(self.preferences, {'project_id': ident})

    def folder(self, ident=None):
        chosen = ident or self.selected
        if chosen and chosen not in self.shared.projects:
            self.shared.refresh_projects()
        return self.shared.folder(chosen)


def import_existing_projects(runtime, studio):
    """Bring the earlier SQL-only shared manuscripts into the full workflow once."""
    marker = runtime.root / '.private' / 'imported-projects.json'
    with runtime.guard:
        if time.monotonic() - getattr(runtime, '_legacy_checked', 0) < 3:
            return
        imported = load(marker) if marker.exists() else {}
        with connection() as conn:
            rows = conn.execute('SELECT id, title, brief, manuscript FROM paramyth.projects WHERE studio_id=%s', (studio['id'],)).fetchall()
            for row in rows:
                old_id = str(row['id'])
                if old_id in imported:
                    continue
                # A deterministic folder also makes recovery after an interrupted import safe.
                folder = runtime.root / 'runs' / 'studio-projects' / ('legacy-' + old_id)
                folder.mkdir(parents=True, exist_ok=True)
                from ..pipeline.api.ui_workspace import export_request
                title = row['title'][:150]
                brief = {'premise': row['brief'], 'medium':'Novel', 'genre':'', 'tone':'', 'pov':'',
                         'themes':[], 'worldRules':[], 'mustAvoid':[], 'chapters':1,
                         'scenesPerChapter':1, 'wordMin':600, 'wordMax':1200, 'characters':[]}
                scene = {'id':'manuscript', 'title':'Manuscript', 'chapter':1, 'pov':'', 'location':'',
                         'content':row['manuscript'], 'state':'Draft', 'minutes':1, 'night':False, 'findings':[]}
                save(folder / 'request.json', {'title':title})
                runtime.refresh_projects()
                ident = runtime.project_id(folder)
                project = {'id':ident, 'title':title, 'owner':studio['name'], 'color':'mint',
                           'updated':now(), 'brief':brief, 'scenes':[scene], 'canon':[], 'versions':[]}
                if not (folder / 'author-workspace.json').exists():
                    save(folder / 'author-workspace.json', project)
                    save(folder / 'request.json', export_request(project, {}))
                    save(folder / 'author-draft.txt', row['manuscript'])
                    comments = conn.execute('''SELECT c.id, c.body, c.created_at, u.display_name
                        FROM paramyth.comments c JOIN paramyth.users u ON u.id=c.user_id
                        WHERE c.project_id=%s ORDER BY c.created_at''', (row['id'],)).fetchall()
                    save(folder / 'team-comments.json', [{**c, 'id':str(c['id']), 'created_at':c['created_at'].isoformat()} for c in comments])
                imported[old_id] = ident
        save(marker, imported)
        runtime._legacy_checked = time.monotonic()


@router.post('/projects/{ident}/share', dependencies=[Depends(write)])
def share_project(ident: str, request: Request, data: dict = Body(...), runtime=Depends(get_runtime)):
    if getattr(runtime, 'studio', None):
        raise HTTPException(409, 'This project is already in a shared team workspace')
    try:
        studio_id = UUID(str(data.get('studio_id', '')))
    except ValueError:
        raise HTTPException(400, 'Choose a team to share with') from None
    with connection() as conn:
        studio = access(conn, accounts.user(request), studio_id, {'owner', 'admin', 'editor'})
    shared = request.app.state.workspaces.for_studio(accounts.user(request)['id'], studio)
    source = runtime.folder(ident).resolve()
    if not source.is_relative_to(runtime.root.resolve()):
        raise HTTPException(400, 'Invalid project folder')
    with runtime.guard, shared.guard:
        mapping = shared.root / '.private' / 'shared-copies.json'
        copies = load(mapping) if mapping.exists() else {}
        source_key = hashlib.sha256((str(accounts.user(request)['id']) + ':' + ident).encode()).hexdigest()
        if source_key in copies and copies[source_key] in shared.projects:
            shared.select(copies[source_key])
            return {'studio_id':str(studio_id), 'project_id':copies[source_key]}
        if any(j['project_id'] == ident and j['status'] in ACTIVE for j in runtime.jobs.values()):
            raise HTTPException(409, 'Wait for this project’s running jobs to finish before sharing it')
        destination = (shared.root / 'runs' / 'studio-projects' / secrets.token_hex(10)).resolve()
        if not destination.is_relative_to(shared.root.resolve()):
            raise HTTPException(400, 'Invalid team project folder')
        if any(p.is_symlink() for p in source.rglob('*')):
            raise HTTPException(409, 'This project contains linked files and cannot be shared safely')
        shutil.copytree(source, destination, symlinks=False)
        shared.refresh_projects()
        created = shared.project_id(destination)
        author = destination / 'author-workspace.json'
        if author.exists():
            value = load(author)
            value.update(id=created, owner=studio['name'], updated=now())
            save(author, value)
        for job in list(runtime.jobs.values()):
            if job['project_id'] == ident and job['status'] not in ACTIVE:
                copied = deepcopy(job)
                copied.update(project_id=created)
                shared.jobs[copied['id']] = copied
                shared.persist(copied['id'])
        shared.select(created)
        copies[source_key] = created
        save(mapping, copies)
    return {'studio_id':str(studio_id), 'project_id':created}


@router.get('/projects/{ident}/discussion')
def discussion(ident: str, runtime=Depends(get_runtime)):
    if not getattr(runtime, 'studio', None):
        return {'comments':[]}
    target = runtime.folder(ident) / 'team-comments.json'
    with runtime.guard:
        return {'comments':load(target) if target.exists() else []}


@router.post('/projects/{ident}/discussion', dependencies=[Depends(write)])
def comment(ident: str, request: Request, data: dict = Body(...), runtime=Depends(get_runtime)):
    if not getattr(runtime, 'studio', None):
        raise HTTPException(400, 'Open a shared team project to comment')
    body = data.get('body', '')
    if not isinstance(body, str) or not 1 <= len(body.strip()) <= 10000:
        raise ValueError('Write a comment of up to 10,000 characters')
    user = accounts.user(request)
    item = {'id':secrets.token_hex(12), 'body':body.strip(), 'display_name':user['display_name'], 'created_at':now()}
    target = runtime.folder(ident) / 'team-comments.json'
    with runtime.guard:
        rows = load(target) if target.exists() else []
        save(target, [*rows, item])
    return item


def field_revision(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def field_revisions(values):
    return {key:field_revision(value) for key, value in values.items()}
