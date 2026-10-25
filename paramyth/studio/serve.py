"""Start the local studio: the API plus the built frontend on 127.0.0.1."""
import argparse
import os
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description='Run the ParaMyth studio on this machine')
    parser.add_argument('--workspace', type=Path, default=Path.cwd(), help='Folder holding runs/ and outputs/ (default: current directory)')
    parser.add_argument('--port', type=int, default=8770)
    parser.add_argument('--host', default='127.0.0.1')
    args = parser.parse_args()
    if args.host not in ('127.0.0.1', 'localhost', '::1') and not os.getenv('PARAMYTH_PUBLIC_ORIGIN'):
        parser.error('Set PARAMYTH_PUBLIC_ORIGIN before binding a public interface')
    try:
        import uvicorn
    except ImportError:
        raise SystemExit("Install the studio extra first: python -m pip install '.[studio]'") from None
    from .app import FRONTEND, create_app
    if not (FRONTEND / 'index.html').is_file():
        print('No frontend build found; serving the API only. Build it with: cd frontend && pnpm build', flush=True)
    os.environ.setdefault('PARAMYTH_WORKSPACE', str(args.workspace.resolve()))
    print(f'ParaMyth studio: http://127.0.0.1:{args.port}/', flush=True)
    # Loopback only: every route also refuses non-local hosts and clients.
    uvicorn.run(create_app(args.workspace), host=args.host, port=args.port, proxy_headers=False)


if __name__ == '__main__':
    main()
