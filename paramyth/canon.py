"""Append-only, source-bound facts with actor-specific current-state projection."""
import copy
import json
from .contracts import require


def initialize(facts):
    result = []
    for i, fact in enumerate(facts):
        result.append({**copy.deepcopy(fact), 'id': f'fact-{i + 1:06}',
                       'kind': fact.get('kind', 'event'), 'source': 'initial',
                       'fact_key': fact.get('fact_key', f'initial-{i + 1}'), 'supersedes': []})
    return result


def append(history, proposed, prose, scene, character_ids):
    records = copy.deepcopy(history)
    lookup = {r['id']: r for r in records}
    replaced = {old for r in records for old in r.get('supersedes', [])}
    for fact in proposed:
        require(fact['evidence'] in prose, 'Canon evidence is not in accepted prose')
        holders = set(fact['known_by'])
        require(bool(holders) and holders <= set(character_ids) | {'public'}, 'Invalid canon witnesses')
        require('public' not in holders or scene.get('public', False), 'Public knowledge requires an explicitly public scene')
        require(holders - {'public'} <= set(scene['participants']), 'Canon witnesses must participate in this scene')
        old_ids = fact.get('supersedes', [])
        require(isinstance(old_ids, list) and all(isinstance(x, str) for x in old_ids) and len(old_ids) == len(set(old_ids)), 'Invalid supersession list')
        key = fact.get('fact_key', f"{scene['id']}-fact-{len(records) + 1}")
        require(isinstance(key, str) and bool(key), 'Invalid fact key')
        for old_id in old_ids:
            require(old_id in lookup and old_id not in replaced, 'Supersession must target an existing current fact')
            require(lookup[old_id]['fact_key'] == key and lookup[old_id]['kind'] == fact['kind'], 'Supersession must preserve key and kind')
        current = [r for r in records if r['id'] not in replaced and r['fact_key'] == key]
        require(not current or set(old_ids) == {r['id'] for r in current}, 'Fact update must explicitly supersede current records')
        if fact['kind'] == 'resource':
            require(type(fact.get('amount')) is int and fact['amount'] >= 0, 'Resource needs a nonnegative integer amount')
            if current:
                require(len(current) == 1 and type(fact.get('change')) is int, 'Resource update needs one prior record and an integer change')
                require(current[0]['amount'] + fact['change'] == fact['amount'], 'Resource arithmetic does not reconcile')
        record = {**copy.deepcopy(fact), 'id': f'fact-{len(records) + 1:06}',
                  'source': scene['id'], 'fact_key': key, 'supersedes': old_ids}
        records.append(record)
        lookup[record['id']] = record
        replaced.update(old_ids)
    return records


def current(history, actor=None):
    # Visibility precedes supersession: an absent actor retains their older knowledge.
    visible = [r for r in history if 'public' in r['known_by'] or actor in r['known_by']]
    replaced = {old for r in visible for old in r.get('supersedes', [])}
    return [r for r in visible if r.get('id') not in replaced]


def select(history, actor, *, budget=7000):
    facts = current(history, actor)
    priority = {'resource': 0, 'relationship': 1, 'thread': 2, 'belief': 3, 'claim': 4, 'event': 5}
    ranked = sorted(facts, key=lambda r: (priority.get(r['kind'], 6), -history.index(r)))
    selected, omitted, used = [], [], 0
    for fact in ranked:
        size = len(json.dumps(fact, ensure_ascii=False))
        if used + size <= budget:
            selected.append(fact)
            used += size
        else:
            omitted.append(fact['id'])
    return {'facts': selected, 'omitted_ids': omitted, 'budget_chars': budget}
