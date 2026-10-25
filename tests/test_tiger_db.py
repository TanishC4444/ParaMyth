import importlib.util
import os
import unittest
from unittest.mock import patch

try:
    from fastapi import HTTPException
    from paramyth.studio import studio_db
except ImportError:
    studio_db = None


@unittest.skipUnless(studio_db and importlib.util.find_spec('psycopg'), 'Install paramyth[studio,tiger]')
class TigerConnectionTests(unittest.TestCase):
    def test_remote_connections_force_verified_tls(self):
        with patch.dict(os.environ, {'PARAMYTH_DATABASE_URL': 'postgresql://app:private@db.example.invalid/app?sslmode=disable',
                'PARAMYTH_DB_LOCAL_TEST': '1', 'PARAMYTH_DB_CA_FILE': 'custom-ca.pem'}), patch('psycopg.connect') as connect:
            with studio_db.connection():
                pass
            self.assertEqual(connect.call_args.kwargs['sslmode'], 'verify-full')
            self.assertEqual(connect.call_args.kwargs['sslrootcert'], 'custom-ca.pem')
            self.assertEqual(connect.call_args.kwargs['connect_timeout'], 10)

    def test_plaintext_exception_requires_explicit_loopback_test(self):
        for flag, host, expected in [('0', 'localhost', 'verify-full'), ('1', 'localhost', 'disable'),
                                      ('1', 'db.example.invalid', 'verify-full')]:
            with self.subTest(flag=flag, host=host), patch.dict(os.environ, {
                    'PARAMYTH_DATABASE_URL': 'postgresql://app:private@' + host + '/app',
                    'PARAMYTH_DB_LOCAL_TEST': flag}), patch('psycopg.connect') as connect:
                with studio_db.connection():
                    pass
                self.assertEqual(connect.call_args.kwargs['sslmode'], expected)
        with patch.dict(os.environ, {'PARAMYTH_DATABASE_URL': 'host=localhost hostaddr=192.0.2.1 dbname=app',
                'PARAMYTH_DB_LOCAL_TEST': '1'}), patch('psycopg.connect') as connect:
            with studio_db.connection():
                pass
            self.assertEqual(connect.call_args.kwargs['sslmode'], 'verify-full')

    def test_errors_and_commit_failures_are_redacted(self):
        import psycopg
        for at_commit in (False, True):
            with self.subTest(at_commit=at_commit), patch.dict(os.environ, {
                    'PARAMYTH_DATABASE_URL': 'postgresql://app:private@db.example.invalid/app'}), \
                    patch('psycopg.connect') as connect:
                error = psycopg.OperationalError('private SQL and password')
                if at_commit:
                    connect.return_value.__exit__.side_effect = error
                else:
                    connect.side_effect = error
                with self.assertRaises(HTTPException) as caught:
                    with studio_db.connection():
                        pass
                self.assertEqual(caught.exception.status_code, 503)
                self.assertNotIn('private', caught.exception.detail)

    def test_migration_uses_separate_owner_and_packaged_sql(self):
        with patch.dict(os.environ, {'PARAMYTH_DATABASE_URL': 'postgresql://app@localhost/app',
                'PARAMYTH_MIGRATION_DATABASE_URL': 'postgresql://owner@localhost/app',
                'PARAMYTH_DB_LOCAL_TEST': '1'}), patch('psycopg.connect') as connect:
            studio_db.migrate()
            self.assertEqual(connect.call_args.args[0], 'postgresql://owner@localhost/app')
            executed = connect.return_value.__enter__.return_value.execute.call_args_list
            self.assertIn('pg_advisory_xact_lock', executed[0].args[0])
            self.assertIn('CREATE SCHEMA IF NOT EXISTS paramyth', executed[1].args[0])
        with patch.dict(os.environ, {'PARAMYTH_MIGRATION_DATABASE_URL': ''}), self.assertRaises(HTTPException):
            studio_db.migrate()
