"""Resumable sequential story coordination with atomic acceptance."""
import copy
import hashlib
import json
from pathlib import Path
from . import contracts
from .executor import Executor
from .storage import export, load, lock, save


def visible(memories, character=None):
    return [m for m in memories if 'public' in m['known_by'] or
            (character is not None and character in m['known_by'])]


def fixture_retrieval(req):
    return {'query': req['premise'], 'sources': [], 'fixture': True}


def run(value, folder, backend='fixture', *, stop_after=None, approve_plan=False,
        transport=None, retrieval=None):
    req = contracts.request(copy.deepcopy(value))
    contracts.require(stop_after is None or type(stop_after) is int and stop_after > 0,
                      'stop_after must be a positive integer')
    contracts.require(type(approve_plan) is bool, 'approve_plan must be boolean')
    contracts.require(backend == 'fixture' or transport is not None,
                      'A custom backend requires an explicit transport')
    identity = getattr(transport, 'identity', None)
    folder = Path(folder)
    fingerprint = hashlib.sha256(json.dumps(req, sort_keys=True).encode()).hexdigest()
    with lock(folder):
        path = folder / 'state.json'
        if path.exists():
            state = load(path)
            contracts.require(state['request_hash'] == fingerprint, 'Request changed; use a new run folder')
            contracts.require(state['backend'] == backend, 'Cannot mix backends when resuming')
            contracts.require(state.get('transport_identity') == identity, 'Provider settings changed; use a new run folder')
        else:
            state = {'transport_identity': identity, 'version': 0, 'backend': backend, 'request_hash': fingerprint,
                     'accepted': [], 'memories': copy.deepcopy(req['initial_facts'])}
            save(folder / 'request.json', req)
            save(path, state)
        executor = Executor(req, folder, transport)
        if 'retrieval' not in state:
            state['retrieval'] = (retrieval or fixture_retrieval)(req)
            save(folder / 'retrieval.json', state['retrieval'])
            save(path, state)
        if 'plan' not in state:
            state['plan'] = executor.call('architect', {'request': req, 'inspiration': state['retrieval']},
                                          lambda x: contracts.plan(x, req))
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
            work = folder / 'work' / card['id']
            packet = {'scene': card, 'premise': req['premise'], 'world_rules': req['world_rules'],
                      'pov_visible_memory': visible(state['memories'], card['pov']),
                      'target_words': req['words_per_scene']}
            proposals = []
            for character in req['characters']:
                if character['id'] in card['participants']:
                    actor_packet = {'character': character, 'location': card['location'], 'time': card['time'],
                                    'visible_memory': visible(state['memories'], character['id'])}
                    proposals.append({'character_id': character['id'],
                                      'proposal': executor.call('character', actor_packet)})
            cast = [{k: c[k] for k in ('id', 'name', 'role', 'public_identity') if k in c} for c in req['characters']]
            direction = executor.call('director', {'scene': card, 'cast': cast, 'proposals': [p for p in proposals if p['character_id'] == card['pov']],
                                                   'accepted_memory': visible(state['memories'], card['pov'])})
            packet.update(direction=direction, cast=cast)
            save(work / 'direction.json', {'proposals': proposals, 'direction': direction})
            draft = executor.call('writer', packet)
            save(work / 'draft.txt', draft)
            accepted = None
            for repair in range(req['max_repairs'] + 1):
                prose = executor.call('humanizer', {'context': packet, 'prose': draft})
                verdict = executor.call('story_quality', {'scene': card, 'cast': cast, 'known_facts': packet['pov_visible_memory'], 'current_prose': prose},
                                         lambda x: contracts.assessed_review(x, prose, ['continuity', 'viewpoint', 'scene_change']))
                save(work / ('review-' + str(repair) + '.json'), verdict)
                if verdict['pass']:
                    accepted = prose
                    break
                if repair < req['max_repairs']:
                    draft = executor.call('writer', {**packet, 'previous_prose': prose, 'review': verdict})
                    save(work / ('repair-' + str(repair + 1) + '.txt'), draft)
            contracts.require(accepted is not None, 'Scene review blocked acceptance')
            memory = executor.call('memory', {'scene': card, 'prose': accepted},
                                   lambda x: contracts.delta(x, accepted, [c['id'] for c in req['characters']]))
            memory_verdict = executor.call('memory_quality', {'prose': accepted, 'memory': memory, 'cast': cast, 'scene': card},
                                           lambda x: contracts.assessed_review(x, accepted, ['evidence', 'knowledge']))
            save(work / 'memory.json', memory)
            contracts.require(memory_verdict['pass'], 'Memory review blocked acceptance')
            if card['id'] == state['plan']['scenes'][card['chapter'] * req['scenes_per_chapter'] - 1]['id']:
                chapter = '\n\n'.join([s['prose'] for s in state['accepted']
                                       if s['chapter'] == card['chapter']] + [accepted])
                chapter_verdict = executor.call('chapter_quality', {'current_prose': chapter, 'cast': cast},
                                                lambda x: contracts.assessed_review(x, chapter, ['continuity', 'viewpoint', 'scene_change']))
                contracts.require(chapter_verdict['pass'], 'Chapter review blocked acceptance')
            next_state = copy.deepcopy(state)
            next_state['version'] += 1
            next_state['accepted'].append({**card, 'prose': accepted, 'review': verdict,
                                           'state_version': next_state['version']})
            next_state['memories'].extend({**m, 'source': card['id']} for m in memory['memories'])
            next_state['complete'] = len(next_state['accepted']) == len(next_state['plan']['scenes'])
            save(path, next_state)
            state = next_state
            save(folder / 'checkpoints' / (card['id'] + '.json'), state)
            export(folder, state, req)
            completed += 1
            if stop_after is not None and completed >= stop_after:
                return state
        return state
