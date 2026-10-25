"""Load owner-managed settings before assembling the application."""
import os
from pathlib import Path


def load_server_environment():
    from dotenv import load_dotenv
    explicit = os.getenv('PARAMYTH_ENV_FILE')
    root = Path(__file__).resolve().parents[2]
    paths = [Path(explicit).expanduser()] if explicit else [root / '.env', root / 'deploy' / '.env']
    for path in paths:
        if explicit and not path.is_file():
            raise ValueError('PARAMYTH_ENV_FILE must point to the server settings file')
        if path.is_file():
            load_dotenv(path, override=False)
    # Railway supplies the public hostname after Generate Domain is enabled.
    if not os.getenv('PARAMYTH_PUBLIC_ORIGIN') and os.getenv('RAILWAY_PUBLIC_DOMAIN'):
        from .hosting import validate_origin
        os.environ['PARAMYTH_PUBLIC_ORIGIN'] = validate_origin('https://' + os.environ['RAILWAY_PUBLIC_DOMAIN'])
