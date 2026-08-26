"""The client half of Anatria3D's control bridge.

Transport only. This module knows how to reach a running Anatria3D, present a
token and put one scene command on the wire; it knows nothing about what a
scene command means, and nothing here validates one against the atlas. That
belongs a layer up, where the manifest is in hand — see `scene_contract` in the
engine for the rule it will apply.

# Configuration

Two environment variables, both set by whoever configures the MCP client:

    ANATRIA3D_BRIDGE_PIPE    the Pipe field from the app's Control bridge panel
    ANATRIA3D_BRIDGE_TOKEN   the Token field from the same panel

Neither has a default, and their absence is not an error — it is how a reader
says they want the atlas without the viewport. `from_environment` returns
`None`, the control tools are never registered, and the server is read-only in
the strong sense that the capability is not there to misuse.

The token is short-lived by design: the application mints a new one every time
the switch is turned on, so a stored one goes stale the moment the reader
turns the bridge off. That is the intended behaviour and not a rough edge —
"off" that left a working credential behind would not be off.

# What it deliberately does not do

There is **no timeout on the handshake read.** The application answers a pair
frame either way — with `{"type":"paired"}`, or with a refusal followed by a
disconnect — so a read that never returns means the far side is wedged, which
no timeout here would repair. MCP clients impose their own call deadline, and
that is the right place for it. Adding a second one would mean a thread blocked
in `ReadFile` that cannot be cancelled, traded for an error message.
"""

from __future__ import annotations

import json
import os
import re
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

#: A line longer than this is not something this protocol produces.
MAX_LINE = 64 * 1024

PAIR_FRAME = "pair"
SCENE_FRAME = "scene_command"


class BridgeUnavailable(RuntimeError):
    """The application could not be reached.

    Not configured, not running, or a second program is holding the pipe. All
    three are the reader's to fix and the message says which.
    """


class BridgeRefused(RuntimeError):
    """The application would not accept this token."""


class ControlBridge:
    """One connection to a running Anatria3D.

    Opened lazily on the first command and kept afterwards, which matters more
    than it looks: the bridge admits one client at a time, so a client that
    connected and disconnected around every command would spend most of its
    life racing itself for the pipe, and would re-pair each time.
    """

    def __init__(self, pipe: str, token: str) -> None:
        self._name = PIPE_PREFIX + PIPE_PREFIX_PATTERN.sub("", pipe.strip())
        self._token = token
        self._stream: BinaryIO | None = None

    @classmethod
    def from_environment(cls) -> ControlBridge | None:
        """Build one from the environment, or `None` when it is not configured.

        Both variables are required together. One without the other is a
        half-finished configuration rather than a preference, and saying so is
        more useful than silently behaving as though neither were set.
        """
        pipe = os.environ.get("ANATRIA3D_BRIDGE_PIPE", "").strip()
        token = os.environ.get("ANATRIA3D_BRIDGE_TOKEN", "").strip()
        if not pipe and not token:
            return None
        if not pipe or not token:
            missing = "ANATRIA3D_BRIDGE_PIPE" if not pipe else "ANATRIA3D_BRIDGE_TOKEN"
            raise BridgeUnavailable(
                f"The control bridge is half-configured: {missing} is not set. "
                "Both the Pipe and the Token from the application's Control "
                "bridge panel are needed."
            )
        return cls(pipe, token)

    @property
    def pipe_name(self) -> str:
        """The full path this client connects to."""
        return self._name

    @property
    def connected(self) -> bool:
        return self._stream is not None

    def send(self, command: Mapping[str, object]) -> None:
        """Put one scene command on the wire.

        Connects and pairs first if needed. A write that fails because the
        application restarted is retried once on a fresh connection — an
        application that was restarted between two commands is an ordinary
        thing, and making the caller distinguish that from a real failure would
        push a reconnect loop into every tool.
        """
        frame = json.dumps({"type": SCENE_FRAME, "command": dict(command)})
        try:
            self._write(frame)
        except (OSError, ValueError):
            self.close()
            # One retry, on a connection built from scratch. If pairing fails
            # this time the error is the honest one: the token is stale, which
            # is what a restarted application means for a client holding the
            # old one.
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
            self._pair(self._stream)
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
                        "is paired with the bridge, it holds the only "
                        "connection until it disconnects."
                    ) from err
                time.sleep(BUSY_RETRY_SECONDS)

    def _pair(self, stream: BinaryIO) -> None:
        """Present the token, and refuse to go on without an answer."""
        stream.write(
            json.dumps({"type": PAIR_FRAME, "token": self._token}).encode("utf-8") + b"\n"
        )
        stream.flush()

        answer = _read_line(stream)
        if answer is None:
            # The application writes a refusal and disconnects, and those two
            # race: often the disconnect wins and the client sees nothing at
            # all. Silence here therefore means the token was wrong far more
            # often than it means anything else, and saying so is more useful
            # than reporting an empty read.
            self.close()
            raise BridgeRefused(
                "The application closed the connection without pairing. The "
                "token is almost certainly stale — it is minted afresh every "
                "time the bridge is switched on. Copy the current one from the "
                "Control bridge panel."
            )

        try:
            parsed = json.loads(answer)
        except json.JSONDecodeError:
            self.close()
            raise BridgeUnavailable(f"Unreadable answer from the bridge: {answer!r}")

        if parsed.get("type") == "paired":
            return

        self.close()
        reason = parsed.get("reason") or parsed.get("message") or answer
        raise BridgeRefused(f"The application refused this client: {reason}")


def _read_line(stream: BinaryIO) -> str | None:
    """One newline-terminated line, or `None` if the far side hung up.

    Read a byte at a time rather than buffered, because the stream is shared
    with whatever comes next and over-reading would swallow it. The only lines
    this ever reads are one-word handshake answers, so the cost is nothing.
    """
    out = bytearray()
    while len(out) < MAX_LINE:
        chunk = stream.read(1)
        if not chunk:
            return None
        if chunk == b"\n":
            return out.decode("utf-8", "replace").rstrip("\r")
        out += chunk
    raise BridgeUnavailable(
        f"The bridge sent {MAX_LINE} bytes with no line ending. That is not "
        "this protocol."
    )
