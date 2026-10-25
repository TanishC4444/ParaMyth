"""Shared SerpAPI research implementation for both planners."""
import sys
from paramyth import production_research as _implementation
sys.modules[__name__] = _implementation
