"""Share the studio account implementation across both API entry points."""
import sys
from paramyth.studio import studio_security as _implementation

sys.modules[__name__] = _implementation
