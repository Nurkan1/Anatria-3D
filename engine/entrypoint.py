"""PyInstaller entry point.

PyInstaller freezes a script path, not a `-m package` invocation, so this thin
wrapper exists purely to give it one. All logic lives in the package.
"""

import sys

from anatria_engine.__main__ import main

if __name__ == "__main__":
    sys.exit(main())
