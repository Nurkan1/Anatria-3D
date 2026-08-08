"""Freeze the AI engine into a self-contained directory for bundling.

Output: `engine/dist/anatria-engine/anatria-engine[.exe]` plus its `_internal`
tree. Rust picks it up from there in development, and `tauri.conf.json` copies
the whole directory into the installer's resource directory for release.

`--onedir`, not `--onefile`, and the reason matters: the one-file bootloader
unpacks to a temp directory and re-executes itself as a child process, so
killing the PID we hold can leave a live Python interpreter behind after the
app window closes. One directory means one process and one PID.

Usage:
    python engine/build_sidecar.py [--clean]
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parent
APP_NAME = "anatria-engine"

# Provider SDKs and Pydantic AI resolve a good deal at import time. PyInstaller's
# static analysis misses some of it, so collect these wholesale. Trim only with
# a packaged smoke test to back it up — a missing submodule shows up as a
# runtime ImportError in the frozen build, never in `python -m`.
COLLECT_ALL = [
    "pydantic",
    "pydantic_ai",
    "anthropic",
    "openai",
    "google.genai",
]

# Pulled in dynamically by httpx/anyio, which every provider SDK sits on.
HIDDEN_IMPORTS = [
    "anyio._backends._asyncio",
]

# Distributions whose *metadata* must ship, not just their modules. These read
# their own version through `importlib.metadata` at import time, and PyInstaller
# does not copy dist-info unless told to. Symptom is a
# `PackageNotFoundError` raised from deep inside pydantic-ai's import chain —
# which looks like a missing dependency rather than a missing .dist-info.
COPY_METADATA = [
    "pydantic-ai-slim",
    "genai-prices",
    "anthropic",
    "openai",
    "google-genai",
    "httpx",
]


def build(clean: bool) -> int:
    if shutil.which("pyinstaller") is None and not _module_available("PyInstaller"):
        print(
            "PyInstaller is not installed.\n"
            "  pip install -e 'engine[dev]'   (or)   pip install pyinstaller",
            file=sys.stderr,
        )
        return 1

    dist = ENGINE_DIR / "dist"
    work = ENGINE_DIR / "build"
    if clean:
        shutil.rmtree(dist, ignore_errors=True)
        shutil.rmtree(work, ignore_errors=True)

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--onedir",
        # Console subsystem: the engine talks over stdin/stdout, which the
        # windowed subsystem does not wire up. Rust spawns it with
        # CREATE_NO_WINDOW so no console is ever visible to the user.
        "--console",
        f"--name={APP_NAME}",
        f"--distpath={dist}",
        f"--workpath={work}",
        f"--specpath={ENGINE_DIR}",
        f"--paths={ENGINE_DIR}",
    ]
    for package in COLLECT_ALL:
        cmd.append(f"--collect-all={package}")
    for module in HIDDEN_IMPORTS:
        cmd.append(f"--hidden-import={module}")
    for distribution in COPY_METADATA:
        cmd.append(f"--copy-metadata={distribution}")
    cmd.append(str(ENGINE_DIR / "entrypoint.py"))

    print(" ".join(cmd))
    result = subprocess.run(cmd, cwd=ENGINE_DIR, check=False)
    if result.returncode != 0:
        return result.returncode

    exe = dist / APP_NAME / (f"{APP_NAME}.exe" if sys.platform == "win32" else APP_NAME)
    if not exe.is_file():
        print(f"build finished but {exe} is missing", file=sys.stderr)
        return 1

    print(f"\nEngine built: {exe}")
    return 0


def _module_available(name: str) -> bool:
    import importlib.util

    return importlib.util.find_spec(name) is not None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--clean",
        action="store_true",
        help="remove previous build and dist directories first",
    )
    args = parser.parse_args()
    return build(clean=args.clean)


if __name__ == "__main__":
    sys.exit(main())
