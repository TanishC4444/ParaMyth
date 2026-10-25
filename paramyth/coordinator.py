"""Sequential canon commits with parallel independent role execution."""
import copy
import hashlib
import json
from pathlib import Path
from . import contracts, canon
from .executor import Executor
from .editorial import scene
from .retrieval import retrieve
from .storage import export, load, lock, save


def visible(memories, character=None):
    return canon.current(memories, character)


def fixture_retrieval(req):
    return {'query': req['premise'], 'sources': [], 'fixture': True}


def request_retrieval(req):
    if not req.get('retrieval_index'):
        contracts.require(req['retrieval_mode'] != 'hybrid', 'Hybrid retrieval requires a retrieval_index')
        return fixture_retrieval(req)
    provider = retrieve
    if req['retrieval_mode'] == 'hybrid':
        try:
            from .rag.search import retrieve as provider
        except ImportError as exc:
            raise contracts.ContractError('Install paramyth[rag] to use hybrid retrieval') from exc
    return provider(req['retrieval_index'], req['premise'], expected_hash=req.get('corpus_hash'))


def run(value, folder, backend='fixture', *, stop_after=None, approve_plan=False,
        transport=None, retrieval=None):
    req = contracts.request(copy.deepcopy(value))
    contracts.require(stop_after is None or type(stop_after) is int and stop_after > 0, 'stop_after must be a positive integer')
    contracts.require(type(approve_plan) is bool, 'approve_plan must be boolean')
    contracts.require(backend == 'fixture' or transport is not None, 'A custom backend requires an explicit transport')
    identity = getattr(transport, 'identity', None)
    folder = Path(folder)
    fingerprint = hashlib.sha256(json.dumps(req, sort_keys=True).encode()).hexdigest()
    with lock(folder):
        path = folder / 'state.json'
        if path.exists():
            state = load(path)
            contracts.require(state.get('schema_version') == 2, 'Run schema changed; start a new folder and retain the old checkpoint')
            contracts.require(state['request_hash'] == fingerprint, 'Request changed; use a new run folder')
            contracts.require(state['backend'] == backend, 'Cannot mix backends when resuming')
            contracts.require(state.get('transport_identity') == identity, 'Provider settings changed; use a new run folder')
        else:
            state = {'schema_version': 2, 'transport_identity': identity, 'version': 0, 'backend': backend, 'request_hash': fingerprint,
                     'accepted': [], 'memories': canon.initialize(req['initial_facts'])}
            save(folder / 'request.json', req)
            save(path, state)
        executor = Executor(req, folder, transport)
        if 'retrieval' not in state:
            state['retrieval'] = retrieval(req) if retrieval else request_retrieval(req)
            save(folder / 'retrieval.json', state['retrieval'])
            save(path, state)
        if 'plan' not in state:
            state['plan'] = executor.call('architect', {'request': req, 'inspiration': state['retrieval']}, lambda x: contracts.plan(x, req))
            state['plan_approved'] = req['auto_approve_plan'] or approve_plan
            save(folder / 'plan.json', state['plan'])
            save(path, state)
        if approve_plan:
            state['plan_approved'] = True
            save(path, state)
        if not state['plan_approved']:
            return state
        export(folder, state, req)
        completed = 0
        for card in state['plan']['scenes'][len(state['accepted']):]:
            prose, verdict, rhetoric, memory = scene(executor, state, req, card, folder)
            if card['id'] == state['plan']['scenes'][card['chapter'] * req['scenes_per_chapter'] - 1]['id']:
                chapter = '\n\n'.join([s['prose'] for s in state['accepted'] if s['chapter'] == card['chapter']] + [prose])
                chapter_status = folder / 'work' / card['id'] / 'chapter-status.json'
                attempt = load(chapter_status).get('attempt', 0) if chapter_status.exists() else 0
                contracts.require(attempt <= req['max_stage_retries'], 'Chapter review recovery budget exhausted')
                check = executor.call('chapter_quality', {'current_prose': chapter, 'cast': req['characters'], 'recovery': attempt},
                    lambda x: contracts.assessed_review(x, chapter, ['continuity', 'viewpoint', 'scene_change']))
                save(folder / 'work' / card['id'] / 'chapter-review.json', check)
                if not check['pass']:
                    save(chapter_status, {'attempt': attempt + 1})
                    raise contracts.ContractError('Chapter review blocked acceptance')
            next_state = copy.deepcopy(state)
            next_state['version'] += 1
            next_state['accepted'].append({**card, 'prose': prose, 'review': verdict, 'rhetoric_review': rhetoric,
                                           'state_version': next_state['version']})
            next_state['memories'] = canon.append(state['memories'], memory['memories'], prose, card, [c['id'] for c in req['characters']])
            next_state['complete'] = False
            save(path, next_state)
            state = next_state
            save(folder / 'checkpoints' / (card['id'] + '.json'), state)
            export(folder, state, req)
            completed += 1
            if stop_after is not None and completed >= stop_after and len(state['accepted']) < len(state['plan']['scenes']):
                return state
        if not state.get('complete'):
            body = '\n\n'.join(s['prose'] for s in state['accepted'])
            contracts.require(state.get('final_attempts', 0) <= req['max_stage_retries'], 'Final audit recovery budget exhausted')
            audit = executor.call('whole_story_quality', {'current_prose': body, 'cast': req['characters'],
                'canon': state['memories'], 'recovery': state.get('final_attempts', 0)}, lambda x: contracts.assessed_review(x, body, ['continuity', 'viewpoint', 'scene_change']))
            save(folder / 'whole-story-review.json', audit)
            if not audit['pass']:
                state['final_attempts'] = state.get('final_attempts', 0) + 1
                save(path, state)
                raise contracts.ContractError('Whole-story audit blocked final publication')
            state['complete'] = True
            state['whole_story_review'] = audit
            save(path, state)
            export(folder, state, req)
        return state
