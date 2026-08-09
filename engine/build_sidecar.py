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
import importlib.metadata
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


def _venv_python() -> Path | None:
    """The repository's own interpreter, if it has been created.

    `.venv` at the repository root — not inside `engine/` — because
    `tests/protocol-contract.test.ts` spawns it from there to generate the
    Pydantic half of the wire format. One virtualenv, one location, both jobs.
    """
    root = ENGINE_DIR.parent
    for candidate in (
        root / ".venv" / "Scripts" / "python.exe",  # Windows
        root / ".venv" / "bin" / "python",  # POSIX
    ):
        if candidate.is_file():
            return candidate
    return None


def missing_requirements() -> list[str]:
    """What this interpreter still lacks for the freeze below to succeed.

    **Asks for everything the build consumes, not for a proxy.** "PyInstaller
    imports" does not mean "the engine's dependencies are here": Debian and Kali
    ship `python3-pyinstaller` as a system package, so a system interpreter
    passes a PyInstaller-only probe, is judged ready, and then dies part-way
    through the freeze with `PackageNotFoundError: pydantic-ai-slim`. The first
    version of this check made exactly that assumption.

    So the probe is derived from `COPY_METADATA` rather than written out
    separately — a distribution added there is a distribution checked here, and
    the two cannot drift apart.

    Never `shutil.which("pyinstaller")`: the build runs
    `sys.executable -m PyInstaller`, so a console script on PATH from some other
    environment says nothing about *this* interpreter.
    """
    missing = [] if _module_available("PyInstaller") else ["PyInstaller"]
    for distribution in COPY_METADATA:
        try:
            importlib.metadata.distribution(distribution)
        except importlib.metadata.PackageNotFoundError:
            missing.append(distribution)
    return missing


def build(clean: bool) -> int:
    # `pnpm sidecar:build` runs whichever `python` is first on PATH, which on a
    # machine that has not activated the venv is an interpreter that has never
    # heard of this project. Re-exec under the repository's own interpreter
    # rather than failing with advice, because the advice is "use the
    # interpreter you already created" and we know where it is.
    missing = missing_requirements()
    if missing:
        venv = _venv_python()
        if venv is not None and venv.resolve() != Path(sys.executable).resolve():
            print(f"{sys.executable} is missing {', '.join(missing)}; retrying with {venv}")
            return subprocess.run([str(venv), __file__, *sys.argv[1:]], check=False).returncode
        print(
            f"This environment is missing: {', '.join(missing)}\n"
            "  python -m venv .venv                 (from the repository root)\n"
            "  .venv/Scripts/python -m pip install -e 'engine[dev]'   # Windows\n"
            "  .venv/bin/python -m pip install -e 'engine[dev]'       # Linux, macOS",
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
