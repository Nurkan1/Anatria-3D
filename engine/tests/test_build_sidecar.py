"""The build script's environment probe.

`build_sidecar.py` decides whether the interpreter running it can freeze the
engine, and re-execs under the repository's virtualenv when it cannot. Getting
that judgement wrong does not fail loudly — it starts a build that dies minutes
later inside PyInstaller, pointing at a package rather than at the interpreter.

It lives beside the package rather than inside it, so it is loaded by path.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest

ENGINE_DIR = Path(__file__).resolve().parent.parent


def load_build_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "build_sidecar", ENGINE_DIR / "build_sidecar.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def build_sidecar() -> ModuleType:
    return load_build_script()


def test_this_environment_can_build_the_sidecar(build_sidecar: ModuleType) -> None:
    """Nothing in COPY_METADATA is absent from the environment running the tests.

    This is the drift guard. `--copy-metadata=<name>` takes a *distribution*
    name, which is not always the import name and is not checked by anything
    else, so a rename upstream or a typo here would only ever surface as a
    failed release build. The test suite runs in the same virtualenv the sidecar
    is frozen from, so if the build would find a distribution missing, so does
    this.
    """
    assert build_sidecar.missing_requirements() == []


def test_a_system_interpreter_with_pyinstaller_is_still_rejected(
    build_sidecar: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Having PyInstaller is not the same as having the project.

    Debian and Kali ship `python3-pyinstaller` as a system package. The first
    version of this probe only asked whether PyInstaller imported, so on those
    distributions the system interpreter was judged ready, the re-exec into the
    virtualenv never happened, and the freeze died on `pydantic-ai-slim`.
    """
    monkeypatch.setattr(build_sidecar, "_module_available", lambda _name: True)
    monkeypatch.setattr(
        build_sidecar.importlib.metadata,
        "distribution",
        _raise_not_found,
    )

    missing = build_sidecar.missing_requirements()

    assert "PyInstaller" not in missing
    assert missing == build_sidecar.COPY_METADATA


def _raise_not_found(name: str):
    raise importlib.metadata.PackageNotFoundError(name)


def test_the_virtualenv_is_looked_for_at_the_repository_root(
    build_sidecar: ModuleType,
) -> None:
    """Not inside `engine/`.

    `tests/protocol-contract.test.ts` spawns the same `.venv` from the root to
    generate the Pydantic half of the wire format. Two virtualenvs would mean
    the contract test and the installer could disagree about what is installed.
    """
    found = build_sidecar._venv_python()

    assert found is not None, "the repository virtualenv is missing"
    assert found.parent.parent.parent == ENGINE_DIR.parent
