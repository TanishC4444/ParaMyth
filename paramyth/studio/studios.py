"""Account and studio collaboration API, separate from caller-owned GitHub tokens."""
from typing import Annotated, Literal
from uuid import UUID
import re
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .studio_db import connection
from .studio_security import (DUMMY_HASH, current_user, digest, new_session,
                              password_hash, password_matches, rate_limit)

router = APIRouter(prefix='/api/v1', tags=['studios'])
Role = Literal['admin', 'editor', 'viewer']


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Credentials(Input):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator('email')
    @classmethod
    def email_address(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
            raise ValueError('Enter a valid email address')
        return value


class Signup(Credentials):
    display_name: str = Field(min_length=1, max_length=100)

    @field_validator('display_name')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('Enter a name')
        return value.strip()


class StudioInput(Input):
    name: str = Field(min_length=1, max_length=100)

    @field_validator('name')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('Enter a studio name')
        return value.strip()


class InvitationInput(Input):
    email: str = Field(min_length=3, max_length=254)
    role: Role = 'editor'
    email_address = field_validator('email')(Credentials.email_address.__func__)


class AcceptInvitation(Input):
    token: str = Field(min_length=32, max_length=100)


class MemberInput(Input):
    role: Role


class PasswordInput(Input):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=1, max_length=128)


class ProjectInput(Input):
    title: str = Field(min_length=1, max_length=200)
    brief: str = Field(default='', max_length=100000)
    manuscript: str = Field(default='', max_length=1000000)

    @field_validator('title')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('Enter a project title')
        return value.strip()


class ProjectUpdate(ProjectInput):
    version: int = Field(ge=1)


class CommentInput(Input):
    body: str = Field(min_length=1, max_length=10000)

    @field_validator('body')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('Write a comment')
        return value.strip()


def context(authorization: Annotated[str | None, Header()] = None):
    with connection() as conn:
        yield conn, current_user(conn, authorization)


# Commit or roll back before sending a successful response to the caller.
Context = Annotated[tuple, Depends(context, scope='function')]


def access(conn, user, studio_id, roles=None):
    # Serialize membership changes and writes on the studio row. Revocation and a
    # concurrent project save cannot race past each other's authorization check.
    studio = conn.execute('''SELECT s.id, s.name, s.owner_id,
        CASE WHEN s.owner_id = %s THEN 'owner' ELSE m.role END AS role
        FROM paramyth.studios s LEFT JOIN paramyth.memberships m
        ON m.studio_id = s.id AND m.user_id = %s WHERE s.id = %s FOR UPDATE OF s''',
        (user['id'], user['id'], studio_id)).fetchone()
    if not studio or not studio['role']:
        raise HTTPException(404, 'Studio not found')
    if roles and studio['role'] not in roles:
        raise HTTPException(403, 'Your studio role does not allow this action')
    return studio


def project(conn, studio_id, project_id):
    value = conn.execute('SELECT * FROM paramyth.projects WHERE id = %s AND studio_id = %s',
                         (project_id, studio_id)).fetchone()
    if not value:
        raise HTTPException(404, 'Project not found')
    return value


def save_revision(conn, value):
    conn.execute('''INSERT INTO paramyth.project_revisions
        (project_id, version, title, brief, manuscript, edited_by)
        VALUES (%s, %s, %s, %s, %s, %s)''',
        (value['id'], value['version'], value['title'], value['brief'], value['manuscript'], value['updated_by']))


def auth_limits(request, email):
    # Never trust an arbitrary client-supplied X-Forwarded-For header here.
    ip = request.client.host if request.client else 'unknown'
    rate_limit('auth-ip', ip, 60)
    rate_limit('auth-email', email, 15)


@router.post('/accounts/signup', status_code=201)
def signup(body: Signup, request: Request):
    auth_limits(request, body.email)
    encoded = password_hash(body.password)
    with connection() as conn:
        user = conn.execute('''INSERT INTO paramyth.users(email, display_name, password_hash)
            VALUES (%s, %s, %s) ON CONFLICT (email) DO NOTHING RETURNING id, email, display_name''',
            (body.email, body.display_name, encoded)).fetchone()
        if not user:
            raise HTTPException(409, 'Unable to create this account. Try signing in.')
        return new_session(conn, user)


@router.post('/accounts/login')
def login(body: Credentials, request: Request):
    auth_limits(request, body.email)
    with connection() as conn:
        user = conn.execute('SELECT id, email, display_name, password_hash FROM paramyth.users WHERE email = %s',
                            (body.email,)).fetchone()
        valid = password_matches(body.password, user['password_hash'] if user else DUMMY_HASH)
        if not user or not valid:
            raise HTTPException(401, 'Email or password is incorrect')
        # Recheck under lock: a concurrent password change must invalidate this login.
        active = conn.execute('SELECT password_hash FROM paramyth.users WHERE id = %s FOR UPDATE',
                              (user['id'],)).fetchone()
        if active['password_hash'] != user['password_hash']:
            raise HTTPException(401, 'Email or password is incorrect')
        del user['password_hash']
        return new_session(conn, user)


@router.get('/accounts/me')
def me(ctx: Context):
    return ctx[1]


@router.post('/accounts/logout', status_code=204)
def logout(ctx: Context, authorization: Annotated[str, Header()]):
    ctx[0].execute('DELETE FROM paramyth.sessions WHERE token_hash = %s', (digest(authorization.partition(' ')[2]),))


@router.post('/accounts/password', status_code=204)
def change_password(body: PasswordInput, ctx: Context):
    conn, user = ctx
    rate_limit('password', str(user['id']), 10)
    row = conn.execute('SELECT password_hash FROM paramyth.users WHERE id = %s FOR UPDATE', (user['id'],)).fetchone()
    if not password_matches(body.current_password, row['password_hash']):
        raise HTTPException(401, 'Current password is incorrect')
    conn.execute('UPDATE paramyth.users SET password_hash = %s WHERE id = %s',
                 (password_hash(body.new_password), user['id']))
    conn.execute('DELETE FROM paramyth.sessions WHERE user_id = %s', (user['id'],))


@router.get('/studios')
def list_studios(ctx: Context):
    conn, user = ctx
    return conn.execute('''SELECT s.id, s.name,
        CASE WHEN s.owner_id = %s THEN 'owner' ELSE m.role END AS role
        FROM paramyth.studios s LEFT JOIN paramyth.memberships m
        ON m.studio_id = s.id AND m.user_id = %s
        WHERE s.owner_id = %s OR m.user_id = %s ORDER BY s.created_at''', (user['id'],) * 4).fetchall()


@router.post('/studios', status_code=201)
def create_studio(body: StudioInput, ctx: Context):
    conn, user = ctx
    rate_limit('create-studio', str(user['id']), 10)
    return conn.execute('INSERT INTO paramyth.studios(name, owner_id) VALUES (%s, %s) RETURNING id, name',
                        (body.name, user['id'])).fetchone()


@router.patch('/studios/{studio_id}')
def rename_studio(studio_id: UUID, body: StudioInput, ctx: Context):
    conn, user = ctx
    access(conn, user, studio_id, {'owner', 'admin'})
    return conn.execute('UPDATE paramyth.studios SET name = %s WHERE id = %s RETURNING id, name',
                        (body.name, studio_id)).fetchone()


@router.get('/studios/{studio_id}/members')
def members(studio_id: UUID, ctx: Context):
    conn, user = ctx
    access(conn, user, studio_id)
    return conn.execute('''SELECT u.id, u.display_name, u.email, 'owner' AS role
        FROM paramyth.studios s JOIN paramyth.users u ON u.id = s.owner_id WHERE s.id = %s
        UNION ALL SELECT u.id, u.display_name, u.email, m.role FROM paramyth.memberships m
        JOIN paramyth.users u ON u.id = m.user_id WHERE m.studio_id = %s ORDER BY display_name''',
        (studio_id, studio_id)).fetchall()


@router.patch('/studios/{studio_id}/members/{user_id}')
def update_member(studio_id: UUID, user_id: UUID, body: MemberInput, ctx: Context):
    conn, user = ctx
    access(conn, user, studio_id, {'owner'})
    row = conn.execute('''UPDATE paramyth.memberships SET role = %s
        WHERE studio_id = %s AND user_id = %s RETURNING user_id, role''', (body.role, studio_id, user_id)).fetchone()
    if not row:
        raise HTTPException(404, 'Member not found, or this is the studio owner')
    return row


@router.delete('/studios/{studio_id}/members/{user_id}', status_code=204)
def remove_member(studio_id: UUID, user_id: UUID, ctx: Context):
    conn, user = ctx
    access(conn, user, studio_id, {'owner'})
    if not conn.execute('DELETE FROM paramyth.memberships WHERE studio_id = %s AND user_id = %s RETURNING user_id',
                        (studio_id, user_id)).fetchone():
        raise HTTPException(404, 'Member not found, or this is the studio owner')


@router.post('/studios/{studio_id}/invitations', status_code=201)
def invite(studio_id: UUID, body: InvitationInput, ctx: Context):
    conn, user = ctx
    studio = access(conn, user, studio_id, {'owner', 'admin'})
    if body.role == 'admin' and studio['role'] != 'owner':
        raise HTTPException(403, 'Only the owner can invite administrators')
    if studio['role'] != 'owner' and conn.execute('''SELECT 1 FROM paramyth.invitations
        WHERE studio_id = %s AND email = %s AND role = 'admin'
        AND consumed_at IS NULL AND expires_at > now()''', (studio_id, body.email)).fetchone():
        raise HTTPException(403, 'Only the owner can replace administrator invitations')
    rate_limit('invite', str(user['id']), 30)
    token = secrets.token_urlsafe(32)
    # Reissuing invalidates earlier unclaimed invitations for this email/studio.
    conn.execute('UPDATE paramyth.invitations SET consumed_at = now() WHERE studio_id = %s AND email = %s AND consumed_at IS NULL',
                 (studio_id, body.email))
    result = conn.execute('''INSERT INTO paramyth.invitations(studio_id, email, role, token_hash, created_by)
        VALUES (%s, %s, %s, %s, %s) RETURNING id, email, role, expires_at''',
        (studio_id, body.email, body.role, digest(token), user['id'])).fetchone()
    return {**result, 'token': token}


@router.get('/studios/{studio_id}/invitations')
def invitations(studio_id: UUID, ctx: Context):
    conn, user = ctx
    access(conn, user, studio_id, {'owner', 'admin'})
    return conn.execute('''SELECT id, email, role, expires_at FROM paramyth.invitations
        WHERE studio_id = %s AND consumed_at IS NULL AND expires_at > now() ORDER BY created_at''', (studio_id,)).fetchall()


@router.delete('/studios/{studio_id}/invitations/{invitation_id}', status_code=204)
def revoke_invitation(studio_id: UUID, invitation_id: UUID, ctx: Context):
    conn, user = ctx
    studio = access(conn, user, studio_id, {'owner', 'admin'})
    row = conn.execute('SELECT role FROM paramyth.invitations WHERE id = %s AND studio_id = %s',
                       (invitation_id, studio_id)).fetchone()
    if not row:
        raise HTTPException(404, 'Invitation not found')
    if row['role'] == 'admin' and studio['role'] != 'owner':
        raise HTTPException(403, 'Only the owner can manage administrator invitations')
    conn.execute('UPDATE paramyth.invitations SET consumed_at = now() WHERE id = %s', (invitation_id,))


@router.post('/invitations/accept')
def accept_invitation(body: AcceptInvitation, ctx: Context):
    conn, user = ctx
    rate_limit('accept-invite', str(user['id']), 30)
    invitation = conn.execute('SELECT studio_id FROM paramyth.invitations WHERE token_hash = %s', (digest(body.token),)).fetchone()
    if not invitation:
        raise HTTPException(404, 'Invitation is invalid or expired')
    studio = conn.execute('SELECT * FROM paramyth.studios WHERE id = %s FOR UPDATE', (invitation['studio_id'],)).fetchone()
    invitation = conn.execute('''SELECT * FROM paramyth.invitations WHERE token_hash = %s
        AND consumed_at IS NULL AND expires_at > now() FOR UPDATE''', (digest(body.token),)).fetchone()
    if not invitation:
        raise HTTPException(404, 'Invitation is invalid or expired')
    if invitation['email'] != user['email']:
        raise HTTPException(403, 'Sign in with the email address this invitation was sent to')
    # Do not let a removed/demoted inviter grant access using an old invitation.
    inviter = conn.execute('SELECT role FROM paramyth.memberships WHERE studio_id = %s AND user_id = %s',
                           (studio['id'], invitation['created_by'])).fetchone()
    owner_invited = studio['owner_id'] == invitation['created_by']
    if not owner_invited and (not inviter or inviter['role'] != 'admin' or invitation['role'] == 'admin'):
        raise HTTPException(404, 'Invitation is no longer valid')
    if user['id'] == studio['owner_id']:
        raise HTTPException(409, 'You already own this studio')
    row = conn.execute('''INSERT INTO paramyth.memberships(studio_id, user_id, role) VALUES (%s, %s, %s)
        ON CONFLICT DO NOTHING RETURNING user_id''', (studio['id'], user['id'], invitation['role'])).fetchone()
    if not row:
        raise HTTPException(409, 'You already belong to this studio')
    conn.execute('UPDATE paramyth.invitations SET consumed_at = now() WHERE id = %s', (invitation['id'],))
    return {'id': studio['id'], 'name': studio['name'], 'role': invitation['role']}


@router.get('/studios/{studio_id}/projects')
def projects(studio_id: UUID, ctx: Context):
    conn, user = ctx
    access(conn, user, studio_id)
    return conn.execute('''SELECT id, title, version, updated_at FROM paramyth.projects
        WHERE studio_id = %s ORDER BY updated_at DESC''', (studio_id,)).fetchall()


@router.post('/studios/{studio_id}/projects', status_code=201)
def create_project(studio_id: UUID, body: ProjectInput, ctx: Context):
    conn, user = ctx
    access(conn, user, studio_id, {'owner', 'admin', 'editor'})
    row = conn.execute('''INSERT INTO paramyth.projects(studio_id, title, brief, manuscript, updated_by)
        VALUES (%s, %s, %s, %s, %s) RETURNING *''',
        (studio_id, body.title, body.brief, body.manuscript, user['id'])).fetchone()
    save_revision(conn, row)
    return row


@router.get('/studios/{studio_id}/projects/{project_id}')
def get_project(studio_id: UUID, project_id: UUID, ctx: Context):
    conn, user = ctx
    access(conn, user, studio_id)
    return project(conn, studio_id, project_id)


@router.put('/studios/{studio_id}/projects/{project_id}')
def update_project(studio_id: UUID, project_id: UUID, body: ProjectUpdate, ctx: Context):
    conn, user = ctx
    access(conn, user, studio_id, {'owner', 'admin', 'editor'})
    project(conn, studio_id, project_id)
    row = conn.execute('''UPDATE paramyth.projects SET title = %s, brief = %s, manuscript = %s,
        version = version + 1, updated_by = %s, updated_at = now()
        WHERE id = %s AND studio_id = %s AND version = %s RETURNING *''',
        (body.title, body.brief, body.manuscript, user['id'], project_id, studio_id, body.version)).fetchone()
    if not row:
        raise HTTPException(409, 'Someone saved a newer version. Copy your changes, then load the latest version and merge.')
    save_revision(conn, row)
    return row


@router.get('/studios/{studio_id}/projects/{project_id}/revisions')
def revisions(studio_id: UUID, project_id: UUID, ctx: Context):
    conn, user = ctx
    access(conn, user, studio_id)
    project(conn, studio_id, project_id)
    return conn.execute('''SELECT r.version, r.created_at, u.display_name FROM paramyth.project_revisions r
        JOIN paramyth.users u ON u.id = r.edited_by WHERE r.project_id = %s ORDER BY r.version DESC LIMIT 100''', (project_id,)).fetchall()


@router.get('/studios/{studio_id}/projects/{project_id}/revisions/{version}')
def revision(studio_id: UUID, project_id: UUID, version: int, ctx: Context):
    conn, user = ctx
    access(conn, user, studio_id)
    project(conn, studio_id, project_id)
    row = conn.execute('SELECT * FROM paramyth.project_revisions WHERE project_id = %s AND version = %s',
                       (project_id, version)).fetchone()
    if not row:
        raise HTTPException(404, 'Revision not found')
    return row


@router.get('/studios/{studio_id}/projects/{project_id}/comments')
def comments(studio_id: UUID, project_id: UUID, ctx: Context):
    conn, user = ctx
    access(conn, user, studio_id)
    project(conn, studio_id, project_id)
    return conn.execute('''SELECT c.id, c.body, c.created_at, u.display_name FROM paramyth.comments c
        JOIN paramyth.users u ON u.id = c.user_id WHERE c.project_id = %s ORDER BY c.created_at DESC LIMIT 100''', (project_id,)).fetchall()


@router.post('/studios/{studio_id}/projects/{project_id}/comments', status_code=201)
def add_comment(studio_id: UUID, project_id: UUID, body: CommentInput, ctx: Context):
    conn, user = ctx
    access(conn, user, studio_id, {'owner', 'admin', 'editor'})
    project(conn, studio_id, project_id)
    return conn.execute('INSERT INTO paramyth.comments(project_id, user_id, body) VALUES (%s, %s, %s) RETURNING id, body, created_at',
                        (project_id, user['id'], body.body)).fetchone()
