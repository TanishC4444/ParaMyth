"""Verify configured credentials without printing or persisting their values."""
import json
import tempfile
import sys
import time
from pathlib import Path

from paramyth.pipeline.hosted import GoogleHosted, HostedError


def main():
    results = []
    with tempfile.TemporaryDirectory() as folder:
        pool = GoogleHosted(Path(folder) / "pool", distinct_projects=False)
        if len(pool.keys) != 10:
            raise SystemExit(f"Expected 10 unique credentials, loaded {len(pool.keys)}")
        print("Loaded 10 unique credentials from Actions secrets", flush=True)
        policy = {
            "timeout": 90 if "--flash-only" in sys.argv else 20, "thinking": "low", "quality_routing": True,
            "estimate_small_calls": True, "request_attempt_limit": 1,
        }
        schema = {
            "type": "object", "properties": {"ok": {"type": "boolean"}},
            "required": ["ok"], "additionalProperties": False,
        }
        checks = [(i, key, "lite") for i, key in enumerate(pool.keys, 1)]
        checks += [(1, pool.keys[0], kind) for kind in ("flash36", "flash")]
        if "--flash-only" in sys.argv:
            checks = checks[-1:]
        for number, (slot, key, kind) in enumerate(checks):
            if number:
                time.sleep(6)  # All ten keys share one project's quota.
            client = GoogleHosted(
                Path(folder) / f"check-{number}", key=key,
                backup_keys=[], distinct_projects=False,
            )
            client.request_budget = {"remaining": 1}
            item = {"slot": slot, "route": kind}
            try:
                text, meta = client.complete(
                    kind, "Return only the requested JSON.",
                    'Return {"ok":true}.', 512, structured=True,
                    response_schema=schema, role="credential_verification", policy=policy,
                )
                item.update(model=meta["model"], passed=json.loads(text) == {"ok": True})
            except HostedError as exc:
                item.update(passed=False, reason=str(exc))
            except Exception as exc:
                item.update(passed=False, reason=type(exc).__name__)
            results.append(item)
            print(json.dumps(item), flush=True)
    print(json.dumps({"results": results, "passed": sum(r["passed"] for r in results)}))
    if not all(r["passed"] for r in results):
        raise SystemExit("At least one credential or model route failed")


if __name__ == "__main__":
    main()
