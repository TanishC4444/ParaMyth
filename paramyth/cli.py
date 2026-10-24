"""Start and resume fixture-backed story runs."""
import argparse
import json
from pathlib import Path
from .coordinator import run
from .storage import load


def main():
    parser = argparse.ArgumentParser(description='ParaMyth sequential story pipeline')
    parser.add_argument('--request', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--approve-plan', action='store_true')
    parser.add_argument('--stop-after', type=int)
    args = parser.parse_args()
    source = args.out / 'request.json' if args.resume else args.request
    if source is None:
        parser.error('--request is required for a new run')
    try:
        state = run(load(source), args.out, stop_after=args.stop_after,
                    approve_plan=args.approve_plan)
        print(json.dumps({'accepted_scenes': len(state['accepted']),
                          'complete': state.get('complete', False),
                          'plan_approved': state['plan_approved']}))
    except (ValueError, RuntimeError, OSError) as exc:
        parser.exit(1, str(exc) + '\n')


if __name__ == '__main__':
    main()
