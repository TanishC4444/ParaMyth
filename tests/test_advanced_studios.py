"""Opt-in PostgreSQL integration tests; only generated test accounts are removed.

Set PARAMYTH_TEST_DATABASE_URL to a migrated disposable or DEV database.
For a local PostgreSQL CI service also set PARAMYTH_DB_LOCAL_TEST=1.
"""
from concurrent.futures import ThreadPoolExecutor
import os
import secrets
import unittest
from unittest.mock import patch

try:
    from fastapi.testclient import TestClient
    from paramyth.pipeline.api.app import app
    from paramyth.pipeline.api.studio_db import connection
    from paramyth.pipeline.api.studio_security import digest, password_hash, password_matches, rate_limit
except ImportError:
    TestClient = None

P = '/api/v1'


@unittest.skipIf(TestClient is None, 'API dependencies not installed')
class StudioSecurityTests(unittest.TestCase):
    def test_password_hashes_are_salted_and_checked(self):
        password = 'a long example password'
        encoded = password_hash(password)
        self.assertNotEqual(encoded, password_hash(password))
        self.assertTrue(password_matches(password, encoded))
        self.assertFalse(password_matches('wrong', encoded))
        self.assertFalse(password_matches(password, 'malformed'))

    def test_validation_does_not_echo_passwords(self):
        client = TestClient(app)
        result = client.post(P + '/accounts/signup', json={'email': 'bad', 'password': 'secret', 'display_name': 'Test'})
        self.assertEqual(result.status_code, 422)
        self.assertNotIn('secret', result.text)
        self.assertNotIn('input', result.text)
        self.assertEqual(result.headers['cache-control'], 'no-store')

    def test_missing_database_fails_closed(self):
        with patch.dict(os.environ, {'PARAMYTH_DATABASE_URL': ''}):
            result = TestClient(app).get(P + '/studios', headers={'Authorization': 'Bearer demo'})
        self.assertEqual(result.status_code, 503)

    def test_commit_failure_cannot_return_success(self):
        from fastapi import HTTPException
        from paramyth.pipeline.api.studios import context
        def failed_commit():
            yield None, {'id': 'test', 'email': 'test@example.invalid', 'display_name': 'Test'}
            raise HTTPException(503, 'Storage commit failed')
        app.dependency_overrides[context] = failed_commit
        try:
            self.assertEqual(TestClient(app).get(P + '/accounts/me').status_code, 503)
        finally:
            del app.dependency_overrides[context]

    def test_oversized_body_rejected_before_database(self):
        result = TestClient(app).post(P + '/accounts/login', content=b'x' * (5 * 1024 * 1024 + 1))
        self.assertEqual(result.status_code, 413)


@unittest.skipUnless(TestClient and os.environ.get('PARAMYTH_TEST_DATABASE_URL'), 'Set a PostgreSQL test URL')
class StudioPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.env = patch.dict(os.environ, {'PARAMYTH_DATABASE_URL': os.environ['PARAMYTH_TEST_DATABASE_URL']})
        cls.env.start()
        cls.prefix = secrets.token_hex(8)
        cls.client = TestClient(app, client=('studio-test-' + cls.prefix, 50000))
        cls.users = []
        cls.owner = cls.signup('owner')
        cls.editor = cls.signup('editor')
        cls.viewer = cls.signup('viewer')
        cls.outsider = cls.signup('outsider')

    @classmethod
    def signup(cls, name):
        body = {'email': f'{cls.prefix}-{name}@example.invalid', 'password': 'integration-passphrase-123', 'display_name': name}
        response = cls.client.post(P + '/accounts/signup', json=body)
        if response.status_code != 201:
            raise AssertionError(f'Signup failed: {response.status_code} {response.text}')
        value = response.json()
        cls.users.append(value['user'])
        return {'headers': {'Authorization': 'Bearer ' + value['token']}, 'body': body, **value}

    @classmethod
    def tearDownClass(cls):
        try:
            with connection() as conn:
                ids = [u['id'] for u in cls.users]
                conn.execute('DELETE FROM paramyth.studios WHERE owner_id = ANY(%s::uuid[])', (ids,))
                conn.execute('DELETE FROM paramyth.users WHERE id = ANY(%s::uuid[])', (ids,))
                buckets = [digest('auth-email:' + u['email']) for u in cls.users]
                buckets += [digest('auth-ip:studio-test-' + cls.prefix)]
                for action in ['create-studio', 'invite', 'accept-invite', 'password']:
                    buckets.extend(digest(action + ':' + str(u['id'])) for u in cls.users)
                conn.execute('DELETE FROM paramyth.auth_limits WHERE bucket = ANY(%s)', (buckets,))
        finally:
            cls.client.close()
            cls.env.stop()

    def call(self, who, method, route, body=None, status=200):
        response = self.client.request(method, P + route, json=body, headers=who['headers'])
        self.assertEqual(response.status_code, status, response.text)
        return response.json() if response.content else None

    def studio(self):
        # Each test owns its own studio; rate-limiting remains enabled.
        return self.call(self.owner, 'POST', '/studios', {'name': self.id().split('.')[-1]}, 201)['id']

    def invite(self, studio, who, role='editor', inviter=None):
        value = self.call(inviter or self.owner, 'POST', f'/studios/{studio}/invitations',
                          {'email': who['user']['email'], 'role': role}, 201)
        self.call(who, 'POST', '/invitations/accept', {'token': value['token']})
        return value

    def test_signup_login_logout_and_secret_storage(self):
        self.call(self.owner, 'POST', '/accounts/signup', self.owner['body'], 409)
        login = self.call(self.owner, 'POST', '/accounts/login', self.owner['body'] | {'display_name': 'bad'}, 422)
        body = {k: v for k, v in self.owner['body'].items() if k != 'display_name'}
        value = self.call(self.owner, 'POST', '/accounts/login', body)
        session = {'headers': {'Authorization': 'Bearer ' + value['token']}}
        self.call(session, 'GET', '/accounts/me')
        with connection() as conn:
            stored = conn.execute('SELECT password_hash FROM paramyth.users WHERE id=%s', (self.owner['user']['id'],)).fetchone()
            self.assertNotIn(body['password'], stored['password_hash'])
            self.assertTrue(conn.execute('SELECT 1 FROM paramyth.sessions WHERE token_hash=%s', (digest(value['token']),)).fetchone())
        self.call(session, 'POST', '/accounts/logout', status=204)
        self.call(session, 'GET', '/accounts/me', status=401)
        self.call(self.owner, 'POST', '/accounts/login', body | {'password': 'wrong-password-value'}, 401)

    def test_invitation_email_expiry_revocation_and_replay(self):
        studio = self.studio()
        route = f'/studios/{studio}/invitations'
        value = self.call(self.owner, 'POST', route, {'email': self.editor['user']['email']}, 201)
        self.call(self.outsider, 'POST', '/invitations/accept', {'token': value['token']}, 403)
        self.call(self.editor, 'POST', '/invitations/accept', {'token': value['token']})
        self.call(self.editor, 'POST', '/invitations/accept', {'token': value['token']}, 404)
        value = self.call(self.owner, 'POST', route, {'email': self.viewer['user']['email']}, 201)
        self.call(self.owner, 'DELETE', route + '/' + value['id'], status=204)
        self.call(self.viewer, 'POST', '/invitations/accept', {'token': value['token']}, 404)
        value = self.call(self.owner, 'POST', route, {'email': self.viewer['user']['email']}, 201)
        with connection() as conn:
            conn.execute("UPDATE paramyth.invitations SET expires_at=now()-interval '1 second' WHERE id=%s", (value['id'],))
        self.call(self.viewer, 'POST', '/invitations/accept', {'token': value['token']}, 404)

    def test_roles_and_tenant_isolation(self):
        studio = self.studio()
        self.invite(studio, self.editor)
        self.invite(studio, self.viewer, 'viewer')
        route = f'/studios/{studio}'
        project = self.call(self.editor, 'POST', route + '/projects', {'title': 'Shared story'}, 201)
        p = route + '/projects/' + project['id']
        for suffix in ['', '/comments', '/revisions', '/revisions/1']:
            self.call(self.viewer, 'GET', p + suffix)
            self.call(self.outsider, 'GET', p + suffix, status=404)
        self.call(self.viewer, 'PUT', p, {'title': 'No', 'version': 1}, 403)
        self.call(self.viewer, 'POST', p + '/comments', {'body': 'No'}, 403)
        self.call(self.editor, 'POST', route + '/invitations', {'email': 'x@example.invalid'}, 403)
        self.call(self.editor, 'PATCH', route + '/members/' + self.viewer['user']['id'], {'role': 'admin'}, 403)
        self.call(self.owner, 'DELETE', route + '/members/' + self.owner['user']['id'], status=404)
        self.call(self.owner, 'DELETE', route + '/members/' + self.editor['user']['id'], status=204)
        self.call(self.editor, 'GET', p, status=404)
        self.call(self.outsider, 'GET', route + '/members', status=404)
        self.call(self.outsider, 'GET', route + '/projects', status=404)
        self.assertNotIn(studio, [s['id'] for s in self.call(self.outsider, 'GET', '/studios')])

    def test_admin_cannot_escalate_and_old_invite_loses_authority(self):
        studio = self.studio()
        self.invite(studio, self.editor, 'admin')
        route = f'/studios/{studio}'
        self.call(self.editor, 'PATCH', route, {'name': 'Renamed'})
        self.call(self.editor, 'POST', route + '/invitations', {'email': self.viewer['user']['email'], 'role': 'admin'}, 403)
        owner_invite = self.call(self.owner, 'POST', route + '/invitations', {'email': self.viewer['user']['email'], 'role': 'admin'}, 201)
        self.call(self.editor, 'POST', route + '/invitations', {'email': self.viewer['user']['email'], 'role': 'editor'}, 403)
        self.call(self.owner, 'DELETE', route + '/invitations/' + owner_invite['id'], status=204)
        value = self.call(self.editor, 'POST', route + '/invitations', {'email': self.viewer['user']['email']}, 201)
        self.call(self.owner, 'PATCH', route + '/members/' + self.editor['user']['id'], {'role': 'viewer'})
        self.call(self.viewer, 'POST', '/invitations/accept', {'token': value['token']}, 404)

    def test_concurrent_updates_preserve_versions_and_comments(self):
        studio = self.studio()
        self.invite(studio, self.editor)
        route = f'/studios/{studio}/projects'
        value = self.call(self.owner, 'POST', route, {'title': 'First', 'manuscript': 'Original'}, 201)
        route += '/' + value['id']
        def write(title):
            return self.client.put(P + route, headers=self.editor['headers'], json={'title': title, 'manuscript': title, 'version': 1})
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(write, ['Alice draft', 'Bob draft']))
        self.assertEqual(sorted(r.status_code for r in responses), [200, 409])
        self.assertEqual(self.call(self.owner, 'GET', route)['version'], 2)
        self.assertEqual(self.call(self.owner, 'GET', route + '/revisions/1')['manuscript'], 'Original')
        self.call(self.editor, 'POST', route + '/comments', {'body': 'Review this paragraph'}, 201)
        self.assertEqual(self.call(self.owner, 'GET', route + '/comments')[0]['body'], 'Review this paragraph')
        other = self.studio()
        self.call(self.owner, 'GET', f'/studios/{other}/projects/' + value['id'], status=404)

    def test_password_change_revokes_all_sessions(self):
        account = self.signup('password')
        self.call(account, 'POST', '/accounts/password', {'current_password': account['body']['password'], 'new_password': 'changed-passphrase-123'}, 204)
        self.call(account, 'GET', '/accounts/me', status=401)
        self.call(account, 'POST', '/accounts/login', {'email': account['user']['email'], 'password': account['body']['password']}, 401)
        self.call(account, 'POST', '/accounts/login', {'email': account['user']['email'], 'password': 'changed-passphrase-123'})

    def test_expired_session_and_github_token_cannot_access_studios(self):
        account = self.signup('expiry')
        with connection() as conn:
            conn.execute("UPDATE paramyth.sessions SET expires_at=now()-interval '1 second' WHERE user_id=%s", (account['user']['id'],))
        self.call(account, 'GET', '/accounts/me', status=401)
        self.call({'headers': {'Authorization': 'Bearer demo'}}, 'GET', '/studios', status=401)

    def test_rate_limit_persists_and_runtime_has_no_schema_creation(self):
        from fastapi import HTTPException
        identity = self.prefix
        try:
            rate_limit('integration', identity, 1)
            with self.assertRaises(HTTPException) as caught:
                rate_limit('integration', identity, 1)
            self.assertEqual(caught.exception.status_code, 429)
            with connection() as conn:
                self.assertFalse(conn.execute("SELECT has_schema_privilege(current_user, 'paramyth', 'CREATE') AS allowed").fetchone()['allowed'])
        finally:
            with connection() as conn:
                conn.execute('DELETE FROM paramyth.auth_limits WHERE bucket=%s', (digest('integration:' + identity),))


if __name__ == '__main__':
    unittest.main()
