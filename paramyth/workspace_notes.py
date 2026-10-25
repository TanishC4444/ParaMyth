"""Validate workspace notes before replacing a user's saved ideas and pins."""
import json


def validate_notes(data):
    if len(json.dumps(data, allow_nan=False)) > 1_000_000:
        raise ValueError('Notes are too large')
    ideas, pins = data.get('ideas', []), data.get('pins', [])
    if not isinstance(ideas, list) or not isinstance(pins, list):
        raise ValueError('Ideas and pins must be lists')
    for idea in ideas:
        # Earlier workspaces also saved plain-text ideas.
        if not isinstance(idea, str) and not (
            isinstance(idea, dict)
            and all(isinstance(idea.get(k), str) for k in ('id', 'label', 'title', 'body', 'color'))
        ):
            raise ValueError('Invalid idea')
    for pin in pins:
        if (not isinstance(pin, dict)
                or not all(isinstance(pin.get(k), str) and pin[k] for k in ('projectId', 'recordId'))
                or not isinstance(pin.get('purpose', ''), str)):
            raise ValueError('Invalid story pin')
    return {'ideas': ideas, 'pins': pins}
