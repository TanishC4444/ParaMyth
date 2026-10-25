"""Keep completed provider audio on the durable workspace volume."""
import os
import threading
import time

from .. import soundtracks
from ..storage import load, save

guard = threading.RLock()
TERMINAL = {'completed', 'failed', 'cancelled', 'expired'}


def archive(path):
    # One process owns the volume; serialize with manual saves and status polling.
    with guard:
        value = load(path)
        ident = soundtracks.job_id(path.stem)
        if value.get('file') or value.get('job', {}).get('status') in {'failed', 'cancelled', 'expired'}:
            return
        try:
            if value.get('job', {}).get('status') not in TERMINAL:
                value.update(job=soundtracks.status(ident), last_check=time.time())
                save(path, value)
            if value.get('job', {}).get('status') == 'completed':
                target = path.with_suffix('.mp3')
                temporary = path.with_suffix('.mp3.tmp')
                try:
                    if not target.exists():
                        soundtracks.download(ident, temporary)
                        os.replace(temporary, target)
                finally:
                    temporary.unlink(missing_ok=True)
                value['file'] = target.name
                value.pop('archive_error', None)
                save(path, value)
        except Exception:
            # Keep the provider ID for retry after reconnect/restart; never resubmit generation.
            value['archive_error'] = 'Audio has not been saved yet. The server will retry.'
            save(path, value)
