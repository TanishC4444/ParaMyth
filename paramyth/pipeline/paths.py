"""Locate the checkout containing pipeline workflows, corpus and web assets."""
import os
from pathlib import Path


def workspace_root():
    configured = os.environ.get('PARAMYTH_PIPELINE_ROOT')
    return Path(configured).expanduser().resolve() if configured else Path(__file__).resolve().parents[2]
