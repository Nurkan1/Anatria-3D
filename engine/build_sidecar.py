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
import os
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


def venv_root() -> Path:
    """Where the repository keeps its virtualenv.

    At the repository root — not inside `engine/` — because
    `tests/protocol-contract.test.ts` spawns it from there to generate the
    Pydantic half of the wire format. One virtualenv, one location, both jobs.
    """
    return ENGINE_DIR.parent / ".venv"


def _venv_python() -> Path | None:
    """The repository's own interpreter, if it has been created."""
    for candidate in (
        venv_root() / "Scripts" / "python.exe",  # Windows
        venv_root() / "bin" / "python",  # POSIX
    ):
        if candidate.is_file():
            return candidate
    return None


def running_in_repo_venv(prefix: str = sys.prefix) -> bool:
    """Whether this interpreter *is* the repository's virtualenv.

    The guard that stops the re-exec below from recurring forever, and it has to
    ask about the environment rather than about the executable.

    **Comparing the interpreter paths is wrong on POSIX**, which is how the
    first version of this shipped broken. `.venv/bin/python` there is a symlink
    to the base interpreter, so resolving it and resolving `sys.executable`
    both arrive at `/usr/bin/python3.x` — identical, and the guard concludes it
    is already inside the virtualenv when it is not. The fallback then never
    fires and the build stops with setup advice for a virtualenv that exists.
    Windows hid it completely: there `python.exe` is a real copy, so the two
    paths differ and the comparison happened to work.

    `sys.prefix` has no such ambiguity. Inside a virtualenv it is the
    virtualenv's own directory; outside one it is the installation the
    interpreter came from.
    """
    try:
        return Path(prefix).resolve() == venv_root().resolve()
    except OSError:
        # An unreadable path is not this virtualenv, and refusing to re-exec is
        # the safe way to be wrong: the build stops with advice rather than
        # spawning itself in a loop.
        return True


#: Speech-to-text and text-to-speech, for the local voice experiment
#: (branch `experiment/voice`).
#:
#: **Opt-in by installation, not by manifest.** They are absent from
#: `pyproject.toml` on purpose: together they add ~260 MB of wheels and their
#: models are downloaded separately, so freezing them into every build is a
#: release decision rather than a default. A build machine without them
#: produces exactly the engine it always did, and the app reports
#: `voice_unavailable`.
VOICE_PACKAGES = ["faster_whisper", "piper"]


def _installed_voice_packages() -> list[str]:
    """Whichever voice engines this interpreter actually has."""
    return [package for package in VOICE_PACKAGES if _module_available(package)]


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
        if venv is not None and not running_in_repo_venv():
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
    # Voice recognition biases towards the atlas's own vocabulary, and the
    # manifest is compiled into the *web* bundle — the sidecar never receives
    # it as a file. Staged beside the package so a frozen build has it; without
    # this the hotword list silently empties in exactly the build where short
    # commands need it, which looks like nothing at all going wrong.
    manifest = ENGINE_DIR.parent / "public" / "anatomy" / "manifest.json"
    if manifest.is_file() and _installed_voice_packages():
        cmd.append(f"--add-data={manifest}{os.pathsep}anatria_engine")
    for package in _installed_voice_packages():
        # `--collect-all`, not `--hidden-import`: piper ships espeak-ng's
        # phoneme tables as *data*, and without them the frozen binary looks
        # for them at the absolute path they had on the machine that built the
        # wheel and dies with
        #     Error processing file '/project/_skbuild/.../phontab'
        # having already emitted `ready`, so the symptom is a request that
        # silently returns nothing.
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
