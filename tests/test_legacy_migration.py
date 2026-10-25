"""Owner-only migration tests against an EMPTY disposable database, never a live DB."""
import os
from pathlib import Path
import unittest

try:
    import psycopg
except ImportError:
    psycopg = None

MIGRATIONS = Path(__file__).resolve().parents[1] / 'paramyth/studio/migrations'
BASE = (MIGRATIONS / '001_studios.sql').read_text(encoding='utf-8')
IMPORT = (MIGRATIONS / '002_import_storyforge.sql').read_text(encoding='utf-8')


@unittest.skipUnless(psycopg and os.getenv('PARAMYTH_MIGRATION_TEST_DATABASE_URL'),
                     'Set an empty disposable migration test database URL')
class LegacyMigrationTests(unittest.TestCase):
    def setUp(self):
        self.conn = psycopg.connect(os.environ['PARAMYTH_MIGRATION_TEST_DATABASE_URL'])
        self.addCleanup(self.conn.close)
        self.addCleanup(self.conn.rollback)
        found = self.conn.execute("SELECT to_regnamespace('paramyth'), to_regnamespace('storyforge')").fetchone()
        if any(found):
            self.fail('Migration tests require an EMPTY disposable database')
        self.conn.execute("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s'")
        self.conn.execute(BASE)

    def seed_legacy(self):
        self.conn.execute(BASE.replace('paramyth', 'storyforge'))
        user = self.conn.execute("INSERT INTO storyforge.users(email,display_name,password_hash) VALUES ('legacy@example.invalid','Legacy','preserve-this-hash') RETURNING id").fetchone()[0]
        studio = self.conn.execute("INSERT INTO storyforge.studios(name,owner_id) VALUES ('Legacy studio',%s) RETURNING id", (user,)).fetchone()[0]
        self.conn.execute("INSERT INTO storyforge.memberships(studio_id,user_id,role) VALUES (%s,%s,'editor')", (studio,user))
        project = self.conn.execute("INSERT INTO storyforge.projects(studio_id,title,updated_by) VALUES (%s,'Original story',%s) RETURNING id", (studio,user)).fetchone()[0]
        self.conn.execute("INSERT INTO storyforge.project_revisions(project_id,version,title,brief,manuscript,edited_by) VALUES (%s,1,'Original story','','',%s)", (project,user))
        self.conn.execute("INSERT INTO storyforge.comments(project_id,user_id,body) VALUES (%s,%s,'Keep this comment')", (project,user))
        self.conn.execute("INSERT INTO storyforge.invitations(studio_id,email,role,token_hash,created_by) VALUES (%s,'invite@example.invalid','editor','invitation-digest',%s)", (studio,user))
        self.conn.execute("INSERT INTO storyforge.auth_limits VALUES ('bucket',1,now()+interval '15 minutes')")
        self.conn.execute("INSERT INTO storyforge.sessions(token_hash,user_id,expires_at) VALUES ('session-digest',%s,now()+interval '7 days')", (user,))
        return user

    def test_complete_copy_preserves_relationships_and_passwords(self):
        self.seed_legacy()
        self.conn.execute(IMPORT)
        for table in ['users','studios','memberships','invitations','projects','project_revisions','comments','auth_limits']:
            with self.subTest(table=table):
                query = psycopg.sql.SQL('SELECT NOT EXISTS ((TABLE storyforge.{0} EXCEPT ALL TABLE paramyth.{0}) UNION ALL (TABLE paramyth.{0} EXCEPT ALL TABLE storyforge.{0}))').format(psycopg.sql.Identifier(table))
                self.assertTrue(self.conn.execute(query).fetchone()[0])
        self.assertEqual(self.conn.execute('SELECT count(*) FROM paramyth.sessions').fetchone()[0], 0)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM storyforge.sessions').fetchone()[0], 1)

    def test_repeat_never_overwrites_new_password(self):
        self.seed_legacy()
        self.conn.execute(IMPORT)
        self.conn.execute("UPDATE paramyth.users SET password_hash='new-password-hash'")
        self.conn.execute(IMPORT)
        self.assertEqual(self.conn.execute('SELECT password_hash FROM paramyth.users').fetchone()[0], 'new-password-hash')

    def test_nonempty_destination_fails_without_merging(self):
        self.seed_legacy()
        self.conn.execute("INSERT INTO paramyth.users(email,display_name,password_hash) VALUES ('new@example.invalid','New','new-hash')")
        with self.assertRaises(psycopg.errors.RaiseException):
            with self.conn.transaction():
                self.conn.execute(IMPORT)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM paramyth.users').fetchone()[0], 1)
        self.assertFalse(self.conn.execute('SELECT EXISTS(SELECT 1 FROM paramyth.schema_migrations WHERE version=2)').fetchone()[0])

    def test_missing_source_fails_without_completion_marker(self):
        with self.assertRaises(psycopg.errors.RaiseException):
            with self.conn.transaction():
                self.conn.execute(IMPORT)
        self.assertFalse(self.conn.execute('SELECT EXISTS(SELECT 1 FROM paramyth.schema_migrations WHERE version=2)').fetchone()[0])
