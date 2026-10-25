"""Share the studio account implementation across both API entry points."""
import sys
from paramyth.studio import studio_db as _implementation

if __name__ == "__main__":
    _implementation.migrate()
else:
    sys.modules[__name__] = _implementation
