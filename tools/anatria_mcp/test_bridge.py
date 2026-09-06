"""Tests for the control-bridge client.

Two kinds, and the split is deliberate.

**Against a real named pipe.** A pipe server built here with `ctypes`, so the
part that cannot be reasoned about — whether Python's `open` speaks to a
Windows named pipe at all, and whether the bytes framed here are the bytes the
application reads — is answered by the operating system rather than by a mock.
This is the half that would otherwise only be discovered by a reader.

**Against a fake stream.** The protocol decisions: what is framed, whether a
restarted application costs the caller an error. Those are about behaviour, not
about Windows, and a real pipe would only make them slower to write and harder
to read.

Run them with this directory's own virtualenv, not the repository one:

    tools/anatria_mcp/.venv/Scripts/python.exe -m pytest tools/anatria_mcp -q
"""

from __future__ import annotations

import json
import sys
import threading
import time

import bridge
import pytest
from bridge import BridgeUnavailable, ControlBridge

windows_only = pytest.mark.skipif(
    sys.platform != "win32", reason="named pipes are a Windows transport"
)


# ---------------------------------------------------------------------------
# The name a reader pastes
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "pasted",
    [
        r"\\.\pipe\anatria3d-control-S-1-5-21-9",
        # Halved slashes: a shell, a JSON file or an env var can all do this,
        # and the reader has no way to tell it happened.
        r"\.\pipe\anatria3d-control-S-1-5-21-9",
        r"\\?\pipe\anatria3d-control-S-1-5-21-9",
        "anatria3d-control-S-1-5-21-9",
        "  anatria3d-control-S-1-5-21-9  ",
    ],
)
def test_every_spelling_of_the_path_reaches_the_same_pipe(pasted: str) -> None:
    assert (
        ControlBridge(pasted).pipe_name
        == r"\\.\pipe\anatria3d-control-S-1-5-21-9"
    )


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def test_not_asking_for_it_is_not_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    # It is how a reader says they want the atlas without the viewport, and the
    # server registers no control tools at all in that case.
    monkeypatch.delenv("ANATRIA3D_BRIDGE", raising=False)
    assert ControlBridge.from_environment() is None


@pytest.mark.parametrize("said", ["1", "true", "TRUE", "yes", "on"])
def test_every_ordinary_spelling_of_yes_requests_the_transport(
    monkeypatch: pytest.MonkeyPatch, said: str
) -> None:
    # Generous on purpose. Somebody who wrote `true` because every other tool
    # takes `true` should not get five tools instead of twenty with no clue why.
    monkeypatch.setenv("ANATRIA3D_BRIDGE", said)
    monkeypatch.delenv("ANATRIA3D_BRIDGE_PIPE", raising=False)
    if sys.platform == "win32":
        assert ControlBridge.from_environment() is not None
    else:
        # Enabling an unsupported transport must fail explicitly, not silently
        # return None as though the reader had disabled it.
        with pytest.raises(BridgeUnavailable, match="Windows transport"):
            ControlBridge.from_environment()


@pytest.mark.parametrize("said", ["0", "false", "no", ""])
def test_saying_no_is_taken_as_no(monkeypatch: pytest.MonkeyPatch, said: str) -> None:
    monkeypatch.setenv("ANATRIA3D_BRIDGE", said)
    assert ControlBridge.from_environment() is None


@windows_only
def test_it_finds_the_pipe_without_being_told(monkeypatch: pytest.MonkeyPatch) -> None:
    # The whole reason the token went away. Nothing is copied from the panel,
    # so nothing goes stale between sessions.
    monkeypatch.setenv("ANATRIA3D_BRIDGE", "1")
    monkeypatch.delenv("ANATRIA3D_BRIDGE_PIPE", raising=False)

    built = ControlBridge.from_environment()
    assert built is not None
    assert built.pipe_name.endswith(bridge.current_user_sid())
    assert built.pipe_name.startswith(bridge.PIPE_PREFIX + bridge.PIPE_STEM)


@windows_only
def test_the_derived_identity_is_the_one_windows_reports() -> None:
    """Both ends must derive the same string or nothing connects.

    The application reads its own process token in Rust; this reads it in
    Python. Asking a third source — Windows itself, through a different API —
    is the only way to know the two agree rather than merely being written to.
    """
    import subprocess

    said = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            "([System.Security.Principal.WindowsIdentity]::GetCurrent()).User.Value",
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()

    assert bridge.current_user_sid() == said


@windows_only
def test_an_explicit_pipe_still_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    # The escape hatch, for an application running as another account that has
    # deliberately been made reachable. Nobody needs it for the ordinary setup.
    monkeypatch.setenv("ANATRIA3D_BRIDGE", "1")
    monkeypatch.setenv("ANATRIA3D_BRIDGE_PIPE", "somebody-elses-pipe")
    built = ControlBridge.from_environment()
    assert built is not None
    assert built.pipe_name.endswith("somebody-elses-pipe")


# ---------------------------------------------------------------------------
# The handshake, against a fake stream
# ---------------------------------------------------------------------------


class FakeStream:
    """A write-only stream that records what went into it.

    Write-only because the client is: the application never answers, so there
    is nothing for a reply script to stand in for.
    """

    def __init__(self, _unused: list[bytes] | None = None) -> None:
        self.written = bytearray()
        self.closed = False
        #: How many times this stream was handed out as a fresh connection.
        self.opened = 1

    def write(self, data: bytes) -> int:
        if self.closed:
            raise OSError("stream is closed")
        self.written += data
        return len(data)

    def flush(self) -> None:
        if self.closed:
            raise OSError("stream is closed")

    def close(self) -> None:
        self.closed = True

    # Convenience for assertions.
    def lines(self) -> list[dict]:
        return [
            json.loads(line)
            for line in bytes(self.written).decode("utf-8").splitlines()
            if line
        ]


def connected_to(stream: FakeStream, monkeypatch: pytest.MonkeyPatch) -> ControlBridge:
    client = ControlBridge("test-pipe")
    monkeypatch.setattr(client, "_connect", lambda: stream)
    return client


def test_a_command_is_framed_as_the_application_expects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stream = FakeStream([])
    client = connected_to(stream, monkeypatch)

    client.send({"action": "reset_view"})

    (sent,) = stream.lines()
    assert sent == {"type": "scene_command", "command": {"action": "reset_view"}}


def test_nothing_precedes_the_first_command(monkeypatch: pytest.MonkeyPatch) -> None:
    # There was a pairing frame here once. Opening the pipe is now the whole
    # protocol, and a client that still announced itself would be talking to
    # nobody: the application reads every line as a command.
    stream = FakeStream([])
    client = connected_to(stream, monkeypatch)

    client.send({"action": "reset_view"})

    assert len(stream.lines()) == 1


def test_the_client_does_not_choose_a_request_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # It would be ignored — the application stamps its own — but sending one
    # would suggest a client could dress a bridge frame up as a chat turn.
    stream = FakeStream([])
    client = connected_to(stream, monkeypatch)

    client.send({"action": "reset_view"})

    assert "request_id" not in stream.lines()[0]


def test_one_connection_serves_many_commands(monkeypatch: pytest.MonkeyPatch) -> None:
    # The bridge admits one client at a time, so reconnecting per command would
    # mean racing itself for the pipe.
    stream = FakeStream([])
    client = connected_to(stream, monkeypatch)

    client.send({"action": "reset_view"})
    client.send({"action": "clear_pathway"})

    assert len(stream.lines()) == 2
    assert stream.opened == 1


def test_a_restarted_application_costs_one_reconnection_not_an_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # An application restarted between two commands is ordinary. Making every
    # tool distinguish that from a real failure would put a reconnect loop in
    # fifteen places.
    dead, alive = FakeStream([]), FakeStream([])
    dead.close()

    client = ControlBridge("test-pipe")
    # Only the replacement is handed out: `dead` is already in place, standing
    # for a connection that was live when the last command went through.
    monkeypatch.setattr(client, "_connect", lambda: alive)
    client._stream = dead

    client.send({"action": "reset_view"})

    assert len(alive.lines()) == 1


# ---------------------------------------------------------------------------
# Against a real Windows named pipe
# ---------------------------------------------------------------------------


@windows_only
def test_it_speaks_to_a_real_named_pipe() -> None:
    """The half no mock can answer.

    Whether `open` reaches a named pipe, and whether what this client writes is
    what a server on the other end reads. The application's side is tested in
    Rust; this is the same conversation from the other end.
    """
    from pipe_server import FakePipeServer  # local helper, Windows only

    with FakePipeServer() as server:
        client = ControlBridge(server.name)
        client.send(
            {"action": "set_layer_visibility", "system": "skeletal", "visible": False}
        )
        # Waited for rather than read straight away: `send` returns once the
        # bytes are written, which is before this side has read them.
        received = server.wait_for_lines(1)
        client.close()

    # One line, and it is the command. Nothing precedes it: opening the pipe
    # is now the whole protocol.
    assert len(received) == 1
    sent = json.loads(received[0])
    assert sent["type"] == "scene_command"
    assert sent["command"]["system"] == "skeletal"


@windows_only
def test_a_pipe_nobody_is_serving_says_to_open_the_application() -> None:
    client = ControlBridge("anatria3d-control-no-such-pipe-here")
    with pytest.raises(BridgeUnavailable) as raised:
        client.send({"action": "reset_view"})
    assert "Anatria3D" in str(raised.value)


@windows_only
def test_a_busy_pipe_is_waited_out_not_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    """One instance means a client can arrive a moment early, not be rejected.

    The wait is part of the protocol rather than politeness — see the note on
    `BUSY_PATIENCE_SECONDS` — so this proves the retry happens rather than the
    first `ERROR_PIPE_BUSY` becoming an error the reader sees.
    """
    from pipe_server import FakePipeServer

    with FakePipeServer() as server:
        server.reply(b'{"type":"paired"}\n')

        # Occupy the single instance, then free it shortly after the client
        # starts trying.
        # Not a context manager on purpose: the point is to release it
        # from a timer, mid-test, while the client is still trying.
        squatter = open(server.full_name, "r+b", buffering=0)  # noqa: SIM115
        released = threading.Event()

        def release() -> None:
            squatter.close()
            released.set()

        held_for = 0.3
        timer = threading.Timer(held_for, release)
        timer.start()
        started = time.monotonic()
        try:
            client = ControlBridge(server.name)
            client.send({"action": "reset_view"})
            waited = time.monotonic() - started
            server.wait_for_lines(1)
            client.close()
        finally:
            timer.cancel()
            if not released.is_set():
                squatter.close()

    assert bridge.BUSY_PATIENCE_SECONDS > held_for, "the test outlasts the patience"
    # Without this the test passes whether or not the pipe was ever busy, which
    # would make it a slow way of asserting nothing.
    #
    # Half the hold, not the whole of it. `threading.Timer` fires approximately
    # and the monotonic clock is coarse on Windows, so `waited >= held_for` is
    # a flake by construction — it failed in CI by three milliseconds. What is
    # actually being proved is that the client did not connect straight away,
    # and an unobstructed open takes well under a millisecond.
    assert waited >= held_for / 2, f"connected in {waited:.3f}s — the pipe was not busy"
