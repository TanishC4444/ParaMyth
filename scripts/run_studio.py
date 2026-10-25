"""Serve the API and studio UI together on this computer."""
import argparse
import os
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8767)
    args = parser.parse_args()
    if not os.environ.get('PARAMYTH_DATABASE_URL'):
        parser.error('Set PARAMYTH_DATABASE_URL in the server environment first (see docs/STUDIO_TEAMS.md)')
    import uvicorn
    from fastapi.staticfiles import StaticFiles
    from paramyth.pipeline.api.app import app
    root = Path(__file__).resolve().parents[1]
    app.mount('/studio', StaticFiles(directory=root / 'web', html=True), name='studio')
    frontend = root / 'frontend-pipeline' / 'dist'
    if (frontend / 'index.html').is_file():
        # Register last so the frontend-pipeline cannot shadow API routes or account pages.
        app.mount('/', StaticFiles(directory=frontend, html=True), name='paramyth')
        print(f'Open http://127.0.0.1:{args.port}/', flush=True)
    else:
        print('Build the ParaMyth frontend-pipeline with: cd frontend-pipeline && pnpm install --frozen-lockfile && pnpm build', flush=True)
        print(f'Account and team screen: http://127.0.0.1:{args.port}/studio/teams.html', flush=True)
    uvicorn.run(app, host='127.0.0.1', port=args.port, proxy_headers=False)


if __name__ == '__main__':
    main()
