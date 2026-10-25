"""Server-only PostgreSQL access. Credentials never enter browser responses."""
from contextlib import contextmanager
from importlib.resources import files
import os

from fastapi import HTTPException


@contextmanager
def connection(*, migration=False):
    variable = 'PARAMYTH_MIGRATION_DATABASE_URL' if migration else 'PARAMYTH_DATABASE_URL'
    url = os.environ.get(variable)
    if not url:
        raise HTTPException(503, 'Migration database is not configured' if migration else 'Studio accounts are not configured on this server')
    try:
        import psycopg
        import certifi
        from psycopg.conninfo import conninfo_to_dict
        from psycopg.rows import dict_row
    except ImportError:
        raise HTTPException(503, 'Install the studio server dependencies') from None
    try:
        # TLS verifies the server certificate; local integration tests explicitly use localhost.
        parsed = conninfo_to_dict(url)
        local_test = (os.environ.get('PARAMYTH_DB_LOCAL_TEST') == '1'
                      and parsed.get('host') in {'localhost', '127.0.0.1', '::1'}
                      and parsed.get('hostaddr', '') in {'', '127.0.0.1', '::1'})
        options = {'sslmode': 'disable'} if local_test else {'sslmode': 'verify-full',
                                         'sslrootcert': os.environ.get('PARAMYTH_DB_CA_FILE') or certifi.where()}
        with psycopg.connect(url, row_factory=dict_row, connect_timeout=10,
                             options='-c statement_timeout=15000 -c lock_timeout=5000', **options) as conn:
            yield conn
    except psycopg.Error:
        # Never include SQL, connection strings, submitted passwords or database diagnostics.
        raise HTTPException(503, 'Studio storage is temporarily unavailable') from None


def migrate():
    """Explicit deploy command, using a separately supplied migration-owner connection."""
    with connection(migration=True) as conn:
        conn.execute('SELECT pg_advisory_xact_lock(747836251)')
        conn.execute(files('paramyth.studio').joinpath('migrations/001_studios.sql').read_text(encoding='utf-8'))


if __name__ == '__main__':
    migrate()
    print('Studio schema is ready.')
