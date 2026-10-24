"""Validated, cached role calls with bounded retries."""
import hashlib
import json
from pathlib import Path
from . import fixture
from .contracts import ContractError
from .storage import load, save


class Executor:
    def __init__(self, req, folder, transport=None):
        self.req = req
        self.folder = Path(folder)
        self.transport = transport or fixture.respond

    def call(self, role, packet, validator=None):
        error = ''
        for attempt in range(self.req['max_stage_retries'] + 1):
            payload = dict(packet)
            if error:
                payload['validation_error'] = error
            encoded = json.dumps([role, payload, self.req], sort_keys=True, ensure_ascii=False)
            if len(json.dumps(payload, ensure_ascii=False)) > self.req['context_chars']:
                raise ContractError('Role input exceeds context budget')
            digest = hashlib.sha256(encoded.encode()).hexdigest()
            path = self.folder / 'calls' / (role + '-' + digest + '.json')
            try:
                if path.exists():
                    output = load(path)['output']
                else:
                    output = self.transport(role, payload, self.req)
                    save(path, {'role': role, 'output': output})
                if not isinstance(output, str) or not output.strip():
                    raise ContractError('Empty role output')
                value = json.loads(output) if validator else output
                return validator(value) if validator else value
            except (ContractError, json.JSONDecodeError) as exc:
                error = str(exc)
        raise ContractError(role + ' failed after bounded retries: ' + error)
