"""Share the studio account implementation across both API entry points."""
import sys
from paramyth.studio import studio_http as _implementation

sys.modules[__name__] = _implementation
