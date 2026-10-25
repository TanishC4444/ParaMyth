"""Bounded parallel scene review and hash-bound stage recovery."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
from . import contracts, canon
from .storage import load, save


def parallel(jobs):
    # Independent roles only. Canon acceptance remains single-threaded.
    with ThreadPoolExecutor(max_workers=min(4, len(jobs))) as pool:
        futures = {name: pool.submit(job) for name, job in jobs.items()}
        results, errors = {}, []
        for name, future in futures.items():
            try:
                results[name] = future.result()
            except Exception as exc:
                errors.append(exc)
        if errors:
            raise errors[0]
        return results


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def scene(executor, state, req, card, folder):
    work = Path(folder) / 'work' / card['id']
    checkpoint_path = work / 'stage.json'
    anchor = digest([state['request_hash'], state['version'], state['memories'], state['accepted'], card, state.get('transport_identity')])
    checkpoint = load(checkpoint_path) if checkpoint_path.exists() else {'anchor': anchor, 'repairs': 0}
    contracts.require(checkpoint['anchor'] == anchor, 'Scene checkpoint does not match accepted state')

    def persist():
        save(checkpoint_path, checkpoint)

    selected = canon.select(state['memories'], card['pov'])
    cast = [{k: c[k] for k in ('id', 'name', 'role', 'public_identity') if k in c} for c in req['characters']]
    packet = {'scene': card, 'premise': req['premise'], 'world_rules': req['world_rules'],
              'pov_visible_memory': selected['facts'], 'memory_selection': selected,
              'inspiration': state['retrieval'], 'target_words': req['words_per_scene'], 'cast': cast}
    if 'draft' not in checkpoint:
        def proposal(character):
            return executor.call('character', {'character': character, 'location': card['location'], 'time': card['time'],
                                 'visible_memory': canon.select(state['memories'], character['id'])['facts']})
        characters = [c for c in req['characters'] if c['id'] in card['participants']]
        proposals = parallel({c['id']: lambda c=c: proposal(c) for c in characters})
        direction = executor.call('director', {'scene': card, 'cast': cast,
                                 'proposals': {card['pov']: proposals[card['pov']]},
                                 'accepted_memory': selected['facts']})
        checkpoint['direction'] = direction
        save(work / 'direction.json', {'proposals': proposals, 'direction': direction})
        packet['direction'] = direction
        checkpoint['draft'] = executor.call('writer', packet)
        save(work / 'draft.txt', checkpoint['draft'])
        persist()
    packet['direction'] = checkpoint['direction']
    if 'prose' not in checkpoint:
        checkpoint['prose'] = executor.call('humanizer', {'context': packet, 'prose': checkpoint['draft']})
        persist()

    while True:
        prose = checkpoint['prose']
        source_hash = digest(prose)
        review_packet = {'scene': card, 'cast': cast, 'known_facts': selected['facts'], 'current_prose': prose}
        required = ['continuity', 'viewpoint', 'scene_change']
        jobs = {}
        for role in ('story_quality', 'rhetoric_quality'):
            if role not in checkpoint:
                categories = required if role == 'story_quality' else ['clarity', 'repetition']
                jobs[role] = lambda role=role, categories=categories: executor.call(role, review_packet,
                    lambda x: contracts.assessed_review(x, prose, categories))
        if 'memory' not in checkpoint:
            jobs['memory'] = lambda: executor.call('memory', {'scene': card, 'prose': prose,
                'prior_fact_index': [{k: m[k] for k in ('id', 'kind', 'fact_key') if k in m} for m in state['memories']]},
                lambda x: contracts.delta(x, prose, [c['id'] for c in req['characters']]))
        # Save each finished branch even when a different branch raises.
        def durable(name, job):
            result = job()
            save(work / (name + '-' + source_hash + '.json'), result)
            return result
        for name in list(jobs):
            branch_path = work / (name + '-' + source_hash + '.json')
            if branch_path.exists():
                checkpoint[name] = load(branch_path)
                del jobs[name]
        if jobs:
            results = parallel({name: lambda name=name, job=job: durable(name, job) for name, job in jobs.items()})
            checkpoint.update(results)
            persist()
        verdict = checkpoint['story_quality']
        rhetoric = checkpoint['rhetoric_quality']
        if verdict['pass'] and rhetoric['pass']:
            break
        contracts.require(checkpoint['repairs'] < req['max_repairs'], 'Scene review blocked acceptance')
        checkpoint['repairs'] += 1
        repaired = executor.call('humanizer', {'context': packet, 'prose': prose,
                      'review': verdict, 'rhetoric_review': rhetoric, 'repair': checkpoint['repairs']})
        contracts.require(digest(repaired) != source_hash, 'Repair did not change rejected prose')
        checkpoint = {'anchor': anchor, 'repairs': checkpoint['repairs'], 'direction': checkpoint['direction'],
                      'draft': checkpoint['draft'], 'prose': repaired}
        save(work / ('repair-' + str(checkpoint['repairs']) + '.txt'), repaired)
        persist()  # All review and memory branches refresh against the exact changed prose.

    memory = checkpoint['memory']
    if 'memory_quality' not in checkpoint:
        contracts.require(checkpoint.get('memory_rechecks', 0) <= req['max_stage_retries'], 'Memory recovery budget exhausted')
        checkpoint['memory_quality'] = executor.call('memory_quality', {'prose': prose, 'memory': memory,
            'cast': cast, 'scene': card, 'recovery': checkpoint.get('memory_rechecks', 0)}, lambda x: contracts.assessed_review(x, prose, ['evidence', 'knowledge']))
        # A failed assessment remains diagnostic; rerunning can obtain a fresh result with a bounded retry token.
        if not checkpoint['memory_quality']['pass']:
            save(work / 'rejected-memory-review.json', checkpoint.pop('memory_quality'))
            checkpoint['memory_rechecks'] = checkpoint.get('memory_rechecks', 0) + 1
            persist()
            raise contracts.ContractError('Memory review blocked acceptance')
        persist()
    save(work / 'memory.json', memory)
    return prose, verdict, rhetoric, memory
