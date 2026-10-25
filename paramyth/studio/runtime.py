"""Workspace projects and bounded, persisted background jobs for the studio API."""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
from pathlib import Path
import secrets
import threading

from ..calendar_sync import GoogleCalendar
from ..soundtracks import discover_stories
from ..storage import load, save

ACTIVE = ('queued', 'running')
MAX_ACTIVE_JOBS = 4
OUTPUT_TYPES = {'.txt', '.json', '.md', '.csv', '.ics', '.png', '.jpg', '.jpeg', '.webp', '.mp3', '.wav', '.opus', '.flac', '.pdf', '.docx', '.zip'}
SKIPPED_DIRS = {'provider-budget', 'model_cache', 'node_modules', '.git'}


def now():
    return datetime.now(timezone.utc).isoformat()


class Runtime:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.token = secrets.token_urlsafe(32)
        self.pool = ThreadPoolExecutor(max_workers=2)
        self.guard = threading.RLock()
        self.jobs, self.projects = {}, {}
        # Calendar tokens and pending OAuth states live in memory only.
        self.google, self.oauth = GoogleCalendar(), {}
        self.job_dir = self.root / 'runs' / 'studio-jobs'
        self.job_dir.mkdir(parents=True, exist_ok=True)
        for file in sorted(self.job_dir.glob('*.json'))[-200:]:
            try:
                item = load(file)
                if item['status'] in ACTIVE:
                    # Work does not survive a restart; say so instead of pretending it continues.
                    item.update(status='interrupted', message='Server restarted. Check outputs and provider usage before retrying.')
                    save(file, item)
                self.jobs[item['id']] = item
            except (ValueError, OSError, KeyError):
                pass
        self.refresh_projects()

    def close(self):
        self.pool.shutdown(wait=False, cancel_futures=True)

    def refresh_projects(self):
        for path in discover_stories(self.root):
            self.projects[hashlib.sha256(str(path).encode()).hexdigest()[:16]] = path

    def project_list(self):
        self.refresh_projects()
        items = []
        for ident, path in self.projects.items():
            title = path.name
            if (path / 'request.json').is_file():
                try:
                    title = load(path / 'request.json').get('title', title)
                except (ValueError, OSError, AttributeError):
                    pass
            elif (path / 'story.txt').is_file():
                title = (path / 'story.txt').read_text(encoding='utf-8-sig').splitlines()[0][:100] or title
            items.append({'id': ident, 'title': title, 'folder': path.relative_to(self.root).as_posix()})
        return items

    def folder(self, ident=None):
        self.refresh_projects()
        if ident:
            if ident not in self.projects:
                raise ValueError('Project not found')
            return self.projects[ident]
        if not self.projects:
            raise ValueError('Create a story project first')
        return next(iter(self.projects.values()))

    def project_id(self, path):
        return next(k for k, v in self.projects.items() if v == Path(path))

    def create_project(self, title, text, brief=None):
        if not isinstance(text, str) or not 1 <= len(text) <= 200000:
            raise ValueError('Story text must contain 1–200,000 characters')
        if not isinstance(title, str) or not title.strip() or len(title) > 150:
            raise ValueError('Project title must contain 1–150 characters')
        if brief is not None and not isinstance(brief, dict):
            raise ValueError('Brief must be a JSON object')
        path = self.root / 'runs' / 'studio-projects' / secrets.token_hex(10)
        path.mkdir(parents=True)
        save(path / 'story.txt', title.strip() + '\n\n' + text)
        if brief is not None:
            save(path / 'request.json', brief)
        self.refresh_projects()
        return self.project_id(path)

    def submit(self, kind, folder, operation, **metadata):
        """Queue operation(progress) for a project. At most four jobs are active at once."""
        with self.guard:
            if sum(j['status'] in ACTIVE for j in self.jobs.values()) >= MAX_ACTIVE_JOBS:
                raise ValueError('Four jobs are already active. Wait for one to finish.')
            ident = secrets.token_hex(12)
            self.jobs[ident] = {'id': ident, 'kind': kind, 'project_id': self.project_id(folder), 'status': 'queued',
                                'created_at': now(), 'message': 'Queued', **metadata}
            self.persist(ident)
            self.pool.submit(self._work, ident, operation)
        return ident

    def persist(self, ident):
        save(self.job_dir / (ident + '.json'), self.jobs[ident])

    def _work(self, ident, operation):
        def progress(message, **update):
            with self.guard:
                self.jobs[ident].update(status='running', message=message, updated_at=now(), **update)
                self.persist(ident)
        try:
            progress('Working')
            result = operation(progress)
            with self.guard:
                self.jobs[ident].update(status='complete', message='Complete', result=result, updated_at=now())
                self.persist(ident)
        except Exception as exc:
            # Expected failures carry a readable reason; anything else stays generic.
            message = str(exc)[:800] if isinstance(exc, (ValueError, OSError, KeyError, TypeError)) else \
                'Unexpected job failure. Inspect saved outputs before retrying.'
            with self.guard:
                self.jobs[ident].update(status='failed', message=message, updated_at=now())
                self.persist(ident)

    def job(self, ident):
        if ident not in self.jobs:
            raise ValueError('Job not found')
        return self.jobs[ident]

    def output_files(self, folder):
        folder, rows = Path(folder), []
        for path in sorted(folder.rglob('*')):
            if len(rows) >= 1000:
                break
            if not path.is_file() or path.is_symlink() or path.name.startswith('.') or path.suffix.lower() not in OUTPUT_TYPES:
                continue
            if SKIPPED_DIRS & set(path.relative_to(folder).parts):
                continue
            stat = path.stat()
            rows.append({'path': path.relative_to(folder).as_posix(), 'bytes': stat.st_size, 'modified': stat.st_mtime, 'type': path.suffix.lower()})
        return rows

    def output_path(self, folder, relative):
        if relative not in {x['path'] for x in self.output_files(folder)}:
            raise ValueError('Output file not found')
        path = (Path(folder) / relative).resolve()
        if not path.is_relative_to(Path(folder).resolve()):
            raise ValueError('Invalid output path')
        return path
