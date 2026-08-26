"""The client half of Anatria3D's control bridge.

Transport only. This module knows how to find a running Anatria3D and put one
scene command on the wire; it knows nothing about what a scene command means,
and nothing here validates one against the atlas. That belongs a layer up,
where the manifest is in hand — see `scene_contract` in the engine.

# Configuration

One environment variable, and it never changes:

    ANATRIA3D_BRIDGE=1

Its absence is not an error — it is how a reader says they want the atlas
without the viewport. `from_environment` returns `None`, the control tools are
never registered, and the server is read-only in the strong sense that the
capability is not there to misuse.

Nothing else is needed because there is nothing else to know. The pipe is named
for the account that created it, and this process runs as that same account, so
it can work the name out for itself — see `current_user_sid`.

## Why there is no token any more

There was one, minted per switch-on and shown in the panel beside the pipe. It
bought less than it cost. The pipe's own permissions already answer the
question that matters — is this the reader's own account — and *which of their
programs* was a question the reader had no way to act on, since any program
running as them could already read their journal and their case files without
going anywhere near a viewport.

Against that, a fresh token every session meant editing a JSON config and
restarting the client each time. The predictable outcome is not a careful
reader; it is somebody concluding the feature is broken. The switch in the
application is the consent gesture, it is visible in the header for as long as
it is on, and closing it takes the pipe with it.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from collections.abc import Mapping
from typing import BinaryIO

#: Windows' prefix for a named pipe. Accepted with or without it, because the
#: application's panel shows the full path and a reader will paste that.
PIPE_PREFIX = "\\\\.\\pipe\\"

#: Every spelling of that prefix worth surviving.
#:
#: Not paranoia — a path full of backslashes is the most mangled thing a reader
#: can paste. It travels through a shell, an editor, a JSON config file and an
#: environment variable, and any of those may halve the doubled slashes. The
#: `?` form is the other legal spelling. Whatever arrives, what matters is the
#: name after it.
PIPE_PREFIX_PATTERN = re.compile(r"^\\{1,2}[.?]\\pipe\\", re.IGNORECASE)

#: How long to keep trying while the pipe reports every instance busy.
#:
#: The bridge accepts one client at a time, so a second program connecting the
#: instant the first leaves arrives before the listener has gone back to
#: accepting. That is a moment early, not a refusal. Mirrors the same patience
#: on the application's own side.
BUSY_PATIENCE_SECONDS = 2.0
BUSY_RETRY_SECONDS = 0.05

SCENE_FRAME = "scene_command"

#: The stem the application builds its pipe name on, with the SID appended.
#: Mirrors `PIPE_STEM` in `control_bridge.rs`; the two must agree or nothing
#: connects, which is what `test_bridge` pins.
PIPE_STEM = "anatria3d-control"


class BridgeUnavailable(RuntimeError):
    """The application could not be reached.

    Not configured, not running, or a second program is holding the pipe. All
    three are the reader's to fix and the message says which.
    """


class ControlBridge:
    """One connection to a running Anatria3D.

    Opened lazily on the first command and kept afterwards, which matters more
    than it looks: the bridge admits one client at a time, so a client that
    connected and disconnected around every command would spend most of its
    life racing itself for the pipe.
    """

    def __init__(self, pipe: str | None = None) -> None:
        name = pipe.strip() if pipe else default_pipe_name()
        self._name = PIPE_PREFIX + PIPE_PREFIX_PATTERN.sub("", name)
        self._stream: BinaryIO | None = None

    @classmethod
    def from_environment(cls) -> ControlBridge | None:
        """Build one if the reader asked for it, or `None` if they did not.

        `ANATRIA3D_BRIDGE` is the whole configuration. `ANATRIA3D_BRIDGE_PIPE`
        is read too and overrides the derived name, which exists for the case
        the derivation cannot cover: an application running as a *different*
        account that has deliberately been made reachable. Nobody needs it for
        the ordinary setup and the panel does not ask for it.
        """
        if os.environ.get("ANATRIA3D_BRIDGE", "").strip().lower() not in _TRUE:
            return None
        override = os.environ.get("ANATRIA3D_BRIDGE_PIPE", "").strip()
        return cls(override or None)

    @property
    def pipe_name(self) -> str:
        """The full path this client connects to."""
        return self._name

    @property
    def connected(self) -> bool:
        return self._stream is not None

    def send(self, command: Mapping[str, object]) -> None:
        """Put one scene command on the wire.

        Connects first if needed. A write that fails because the application
        restarted is retried once on a fresh connection — an application
        restarted between two commands is an ordinary thing, and making the
        caller distinguish that from a real failure would push a reconnect loop
        into every tool.
        """
        frame = json.dumps({"type": SCENE_FRAME, "command": dict(command)})
        try:
            self._write(frame)
        except (OSError, ValueError):
            self.close()
            # One retry, on a connection built from scratch. If the application
            # really has gone, the second attempt fails with the honest error:
            # nothing is listening.
            self._write(frame)

    def close(self) -> None:
        stream, self._stream = self._stream, None
        if stream is not None:
            try:
                stream.close()
            except OSError:
                # Already gone. Nothing here can act on that, and raising from
                # a close would mask whatever the caller was really doing.
                pass

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _write(self, frame: str) -> None:
        stream = self._ensure()
        stream.write(frame.encode("utf-8") + b"\n")
        stream.flush()

    def _ensure(self) -> BinaryIO:
        if self._stream is None:
            self._stream = self._connect()
        return self._stream

    def _connect(self) -> BinaryIO:
        """Open the pipe, waiting out a momentarily busy one.

        The two failures worth naming are named, and everything else is
        retried until the deadline. That is not laziness about error handling:
        `open` reaches a named pipe through the C runtime, which translates
        Win32 codes into errno and **loses `ERROR_PIPE_BUSY` on the way** — a
        busy pipe surfaces as a bare `OSError` with `EINVAL` and no `winerror`
        to test. Retrying the unrecognised cases is therefore the only way to
        wait out the one case that must be waited out, and a genuinely
        permanent fault costs two seconds before it is reported accurately.
        """
        deadline = time.monotonic() + BUSY_PATIENCE_SECONDS
        while True:
            try:
                return open(self._name, "r+b", buffering=0)
            except FileNotFoundError as err:
                raise BridgeUnavailable(
                    f"Nothing is listening on {self._name}. Open Anatria3D and "
                    "switch the control bridge on in Settings."
                ) from err
            except PermissionError as err:
                raise BridgeUnavailable(
                    f"Not allowed to open {self._name}. The bridge admits only "
                    "the account that created it."
                ) from err
            except OSError as err:
                if time.monotonic() >= deadline:
                    raise BridgeUnavailable(
                        f"Could not open {self._name} after waiting "
                        f"{BUSY_PATIENCE_SECONDS:g}s: {err}. If another program "
                        "is connected to the bridge, it holds the only "
                        "connection until it disconnects."
                    ) from err
                time.sleep(BUSY_RETRY_SECONDS)


# ---------------------------------------------------------------------------
# Finding the application without being told where it is
# ---------------------------------------------------------------------------

#: What counts as "yes" in an environment variable.
#:
#: Generous on purpose. Somebody who wrote `true` because every other tool
#: takes `true` should not be left with a server that silently offers five
#: tools instead of twenty and no clue why.
_TRUE = {"1", "true", "yes", "on"}


def default_pipe_name() -> str:
    """The pipe an Anatria3D running as this account will have created.

    This is what replaces the pipe-and-token copying. The application names its
    pipe for the account that owns it, this process runs as the same account,
    so the name is derivable rather than something a person has to carry across
    a config file.
    """
    return f"{PIPE_STEM}-{current_user_sid()}"


def current_user_sid() -> str:
    """This process's own user SID, in the `S-1-5-21-...` string form.

    Read from the process token rather than from a username, which is what
    `control_acl::current_user_sid` on the application's side does — the two
    have to produce the same string or nothing connects, and asking Windows the
    same question twice is the only way to be sure of that. A username would
    also have to be looked up, and would differ across domains.

    `ctypes` rather than pywin32: this virtualenv is one a reader creates by
    hand, and a dependency for one function is a dependency in every future
    install instruction.
    """
    if sys.platform != "win32":
        raise BridgeUnavailable(
            "The control bridge is a Windows transport; this build has none."
        )

    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)

    TOKEN_QUERY = 0x0008
    TOKEN_USER = 1

    # Declared, all of them. `GetCurrentProcess` returns the pseudo-handle -1,
    # and without a restype ctypes hands it on as a C int, which overflows the
    # moment the next call wants a HANDLE.
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    advapi32.OpenProcessToken.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.HANDLE),
    ]
    advapi32.GetTokenInformation.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
    ]
    advapi32.ConvertSidToStringSidW.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(wintypes.LPWSTR),
    ]

    token = wintypes.HANDLE()
    if not advapi32.OpenProcessToken(
        kernel32.GetCurrentProcess(), TOKEN_QUERY, ctypes.byref(token)
    ):
        raise BridgeUnavailable(
            f"Could not read this process's token (Win32 {ctypes.get_last_error()})."
        )

    try:
        # Asked twice: a TOKEN_USER is a header followed by a variable-length
        # SID, so the first call fails and reports the size it needs.
        needed = wintypes.DWORD(0)
        advapi32.GetTokenInformation(
            token, TOKEN_USER, None, 0, ctypes.byref(needed)
        )
        if not needed.value:
            raise BridgeUnavailable(
                f"Could not size this account's identity "
                f"(Win32 {ctypes.get_last_error()})."
            )

        buffer = ctypes.create_string_buffer(needed.value)
        if not advapi32.GetTokenInformation(
            token, TOKEN_USER, buffer, needed, ctypes.byref(needed)
        ):
            raise BridgeUnavailable(
                f"Could not read this account's identity "
                f"(Win32 {ctypes.get_last_error()})."
            )

        # TOKEN_USER is a SID_AND_ATTRIBUTES, whose first member is the pointer
        # to the SID itself.
        sid = ctypes.c_void_p.from_buffer(buffer)
        text = wintypes.LPWSTR()
        if not advapi32.ConvertSidToStringSidW(sid, ctypes.byref(text)):
            raise BridgeUnavailable(
                f"Could not render this account's identity as text "
                f"(Win32 {ctypes.get_last_error()})."
            )
        try:
            return str(text.value)
        finally:
            kernel32.LocalFree(text)
    finally:
        kernel32.CloseHandle(token)
