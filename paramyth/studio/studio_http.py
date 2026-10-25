"""Bound studio request sizes and prevent caching account/project responses."""
import json


def studio_path(path):
    return path.startswith(('/api/v1/accounts', '/api/v1/studios', '/api/v1/invitations'))


class StudioHTTPMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or not studio_path(scope['path']):
            return await self.app(scope, receive, send)
        chunks, size = [], 0
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            size += len(message.get('body', b''))
            if size > 5 * 1024 * 1024:
                await send({'type': 'http.response.start', 'status': 413,
                            'headers': [(b'content-type', b'application/json'), (b'cache-control', b'no-store')]})
                await send({'type': 'http.response.body', 'body': json.dumps({'detail': 'Request is too large'}).encode()})
                return
            chunks.append(message.get('body', b''))
            if not message.get('more_body'):
                break

        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {'type': 'http.request', 'body': b''.join(chunks), 'more_body': False}
            return await receive()

        async def secure_send(message):
            if message['type'] == 'http.response.start':
                message['headers'] = list(message.get('headers', [])) + [
                    (b'cache-control', b'no-store'), (b'x-content-type-options', b'nosniff')]
            await send(message)

        await self.app(scope, replay, secure_send)
