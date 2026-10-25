"""Account-owned durable workspaces. Use one server process and a persistent volume."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import threading
from uuid import UUID

from fastapi import HTTPException

from ..calendar_sync import GoogleCalendar
from ..storage import load, save
from .runtime import Runtime


class PrivateCalendar(GoogleCalendar):
    """Each account's OAuth tokens are encrypted outside the downloadable projects."""
    def __init__(self, root, encryption_key):
        from cryptography.fernet import Fernet
        self.access, self.refresh, self.expires = '', '', 0
        self.path = root / '.private' / 'calendar.enc'
        self.cipher = Fernet(encryption_key)
        self.guard = threading.RLock()
        if self.path.exists():
            value = json.loads(self.cipher.decrypt(self.path.read_bytes()))
            self.access, self.refresh, self.expires = value['access'], value['refresh'], value['expires']

    def accept(self, value):
        with self.guard:
            super().accept(value)
            encrypted = self.cipher.encrypt(json.dumps({'access': self.access, 'refresh': self.refresh,
                                                       'expires': self.expires}).encode()).decode()
            save(self.path, encrypted)


class UserRuntime(Runtime):
    def __init__(self, root, manager):
        self.manager = manager
        super().__init__(root)
        self.pool.shutdown(wait=False)
        self.pool = manager.pool
        self.google = PrivateCalendar(self.root, manager.encryption_key)
        self.preferences = self.root / '.private' / 'preferences.json'
        self.selected = load(self.preferences).get('project_id') if self.preferences.exists() else None

    def refresh_projects(self):
        super().refresh_projects()
        # IDs must survive restoring the volume at a different absolute path.
        self.projects = {hashlib.sha256(p.relative_to(self.root).as_posix().encode()).hexdigest()[:16]: p
                         for p in self.projects.values() if p.resolve().is_relative_to(self.root)}

    def folder(self, ident=None):
        try:
            return super().folder(ident or getattr(self, 'selected', None))
        except ValueError:
            raise HTTPException(404, 'Project not found in your account') from None

    def job(self, ident):
        if ident not in self.jobs:
            raise HTTPException(404, 'Job not found in your account')
        return self.jobs[ident]

    def select(self, ident):
        self.folder(ident)
        with self.guard:
            self.selected = ident
            save(self.preferences, {'project_id': ident})

    def submit(self, kind, folder, operation, **metadata):
        if not self.manager.slots.acquire(blocking=False):
            raise HTTPException(429, 'The studio is busy. Try again after a running job finishes.')
        def run(progress):
            try:
                return operation(progress)
            finally:
                self.manager.slots.release()
        try:
            return super().submit(kind, folder, run, **metadata)
        except BaseException:
            self.manager.slots.release()
            raise

    def close(self):
        pass  # The manager owns the shared executor.


class Workspaces:
    def __init__(self, root, encryption_key):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.encryption_key = encryption_key
        self.pool = ThreadPoolExecutor(max_workers=4)
        self.slots = threading.BoundedSemaphore(16)
        self.guard = threading.RLock()
        self.runtimes = {}
        self.studios = {}
        self.stopping = threading.Event()
        self.archiver = threading.Thread(target=self.archive_music, daemon=True, name='music-archive')
        self.archiver.start()

    def archive_music_once(self):
        from .music_archive import archive
        paths = (*self.root.glob('users/*/runs/**/soundtracks/music_*.json'),
                 *self.root.glob('studios/*/runs/**/soundtracks/music_*.json'))
        for path in paths:
            if self.stopping.is_set():
                break
            try:
                if path.resolve().is_relative_to(self.root):
                    archive(path)
            except (ValueError, OSError):
                continue

    def archive_music(self):
        while not self.stopping.wait(15):
            self.archive_music_once()

    def get(self, user_id):
        ident = str(UUID(str(user_id)))
        with self.guard:
            if ident not in self.runtimes:
                self.runtimes[ident] = UserRuntime(self.root / 'users' / ident, self)
            return self.runtimes[ident]

    def for_studio(self, user_id, studio):
        from .team_workspace import StudioRuntime, import_existing_projects
        ident = str(UUID(str(studio['id'])))
        with self.guard:
            if ident not in self.studios:
                self.studios[ident] = UserRuntime(self.root / 'studios' / ident, self)
            shared = self.studios[ident]
        import_existing_projects(shared, studio)
        return StudioRuntime(shared, self.get(user_id), studio)

    def close(self):
        self.stopping.set()
        self.pool.shutdown(wait=True)
        self.archiver.join(timeout=2)
