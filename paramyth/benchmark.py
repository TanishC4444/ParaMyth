"""Small explicit fixture/live scene and checkpoint benchmarks."""
import argparse
import json
from pathlib import Path
import time
from .coordinator import run
from .live import ChatTransport
from .storage import save


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--backend', choices=['fixture', 'live'], default='fixture')
    parser.add_argument('--case', choices=['single', 'sequence', 'resume'], required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    transport = ChatTransport.from_env() if args.backend == 'live' else None
    req = json.loads(Path('example.json').read_text())
    req.update(chapters=1, scenes_per_chapter=1 if args.case == 'single' else 3,
               words_per_scene=200, max_stage_retries=1, max_repairs=1)
    started = time.monotonic()
    report = {'backend': args.backend, 'case': args.case, 'accepted': False,
              'literary_assessment': 'pending human review' if transport else 'synthetic fixture only'}
    try:
        if args.case == 'resume':
            prefix = run(req, args.out, backend=args.backend, transport=transport,
                         approve_plan=True, stop_after=1)
            before = json.loads(json.dumps(prefix['accepted']))
        state = run(req, args.out, backend=args.backend, transport=transport, approve_plan=True)
        if args.case == 'resume' and state['accepted'][:1] != before:
            raise RuntimeError('Accepted prefix changed on resume')
        report.update(accepted=state.get('complete', False), scenes=len(state['accepted']))
    finally:
        report['elapsed_seconds'] = time.monotonic() - started
        report['provider_attempts'] = len(transport.events) if transport else 0
        save(args.out / 'benchmark.json', report)


if __name__ == '__main__':
    main()
