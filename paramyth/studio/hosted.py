"""Start one FastAPI process on the hosting platform's assigned port."""
import os
from pathlib import Path
from .server_settings import load_server_environment


def settings():
    load_server_environment()
    from .hosting import validate_origin
    validate_origin(os.environ.get('PARAMYTH_PUBLIC_ORIGIN', ''))
    port = int(os.environ.get('PORT', '8000'))
    if not 1 <= port <= 65535:
        raise ValueError('PORT must be between 1 and 65535')
    workspace = os.environ.get('PARAMYTH_WORKSPACE')
    if not workspace:
        raise ValueError('Set PARAMYTH_WORKSPACE to the persistent volume mount')
    return port, Path(workspace).resolve()


def main():
    port, workspace = settings()
    workspace.mkdir(parents=True, exist_ok=True)
    # Railway volumes start as root-owned. Prepare only the configured mount,
    # then drop privileges before the application accepts any request.
    if os.name == 'posix' and os.geteuid() == 0:
        import pwd
        account = pwd.getpwnam('paramyth')
        os.chown(workspace, account.pw_uid, account.pw_gid)
        os.setgroups([])
        os.setgid(account.pw_gid)
        os.setuid(account.pw_uid)
        # libpq and provider caches must not look in root's private home after
        # the UID change (Railway starts the container as root for its volume).
        os.environ['HOME'] = account.pw_dir
        os.environ['USER'] = account.pw_name
        os.environ['LOGNAME'] = account.pw_name
    from .app import create_app
    import uvicorn
    trusted = os.environ.get('PARAMYTH_TRUSTED_PROXIES', '')
    uvicorn.run(create_app(workspace), host='0.0.0.0', port=port,
                proxy_headers=bool(trusted), forwarded_allow_ips=trusted,
                workers=1, timeout_graceful_shutdown=90)


if __name__ == '__main__':
    main()
