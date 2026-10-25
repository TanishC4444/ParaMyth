"""Validated role calls and durable per-attempt diagnostics."""
import hashlib
import json
from pathlib import Path
import time
import uuid
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
        event_offset = len(getattr(self.transport, 'events', []))
        for attempt in range(self.req['max_stage_retries'] + 1):
            started = time.monotonic()
            report = {'role': role, 'attempt': attempt + 1, 'cached': False,
                      'finish_reason': None, 'usage': None, 'status': 'error'}
            payload = dict(packet)
            if error:
                payload['validation_error'] = error
            encoded = json.dumps([2, role, payload, self.req], sort_keys=True, ensure_ascii=False)
            digest = hashlib.sha256(encoded.encode()).hexdigest()
            path = self.folder / 'calls' / (role + '-' + digest + '.json')
            try:
                if len(json.dumps(payload, ensure_ascii=False)) > self.req['context_chars']:
                    raise ContractError('Role input exceeds context budget')
                report['cached'] = path.exists()
                response = load(path)['output'] if path.exists() else self.transport(role, payload, self.req)
                if isinstance(response, dict):
                    report['finish_reason'] = response.get('finish_reason')
                    report['usage'] = response.get('usage')
                    if response.get('finish_reason') not in {'stop', 'eos', 'end_turn'}:
                        raise ContractError('Incomplete role response: ' + str(response.get('finish_reason')))
                    output = response.get('text')
                else:
                    output = response  # Legacy string transports, including deterministic fixtures.
                if not isinstance(output, str) or not output.strip():
                    raise ContractError('Empty role output')
                value = json.loads(output) if validator else output
                result = validator(value) if validator else value
                if not report['cached']:
                    save(path, {'role': role, 'output': response})
                report['status'] = 'accepted'
                return result
            except (ContractError, json.JSONDecodeError) as exc:
                error = str(exc)
                report['error_type'] = type(exc).__name__
                report['error'] = error
            except Exception as exc:
                # Unknown transport failures are recorded and propagated, not blindly retried.
                report['error_type'] = type(exc).__name__
                report['error'] = 'Transport raised ' + type(exc).__name__
                raise
            finally:
                report['provider_attempts'] = getattr(self.transport, 'events', [])[event_offset:]
                event_offset = len(getattr(self.transport, 'events', []))
                report['elapsed_seconds'] = time.monotonic() - started
                save(self.folder / 'attempts' / (uuid.uuid4().hex + '.json'), report)
        raise ContractError(role + ' failed after bounded retries: ' + error)
