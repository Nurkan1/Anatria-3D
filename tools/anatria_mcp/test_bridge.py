"""Tests for the control-bridge client.

Two kinds, and the split is deliberate.

**Against a real named pipe.** A pipe server built here with `ctypes`, so the
part that cannot be reasoned about — whether Python's `open` speaks to a
Windows named pipe at all, and whether the bytes framed here are the bytes the
application reads — is answered by the operating system rather than by a mock.
This is the half that would otherwise only be discovered by a reader.

**Against a fake stream.** The protocol decisions: what a refusal looks like,
what silence means, whether a restarted application costs the caller an error.
Those are about behaviour, not about Windows, and a real pipe would only make
them slower to write and harder to read.

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
from bridge import BridgeRefused, BridgeUnavailable, ControlBridge

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
        ControlBridge(pasted, "t").pipe_name
        == r"\\.\pipe\anatria3d-control-S-1-5-21-9"
    )


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def test_no_configuration_is_not_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    # It is how a reader says they want the atlas without the viewport, and the
    # server registers no control tools at all in that case.
    monkeypatch.delenv("ANATRIA3D_BRIDGE_PIPE", raising=False)
    monkeypatch.delenv("ANATRIA3D_BRIDGE_TOKEN", raising=False)
    assert ControlBridge.from_environment() is None


@pytest.mark.parametrize("present", ["ANATRIA3D_BRIDGE_PIPE", "ANATRIA3D_BRIDGE_TOKEN"])
def test_half_a_configuration_says_which_half_is_missing(
    monkeypatch: pytest.MonkeyPatch, present: str
) -> None:
    monkeypatch.delenv("ANATRIA3D_BRIDGE_PIPE", raising=False)
    monkeypatch.delenv("ANATRIA3D_BRIDGE_TOKEN", raising=False)
    monkeypatch.setenv(present, "something")

    with pytest.raises(BridgeUnavailable) as raised:
        ControlBridge.from_environment()

    missing = (
        "ANATRIA3D_BRIDGE_TOKEN"
        if present == "ANATRIA3D_BRIDGE_PIPE"
        else "ANATRIA3D_BRIDGE_PIPE"
    )
    assert missing in str(raised.value)


def test_a_full_configuration_builds_a_client(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANATRIA3D_BRIDGE_PIPE", "some-pipe")
    monkeypatch.setenv("ANATRIA3D_BRIDGE_TOKEN", "abc")
    built = ControlBridge.from_environment()
    assert built is not None
    assert built.pipe_name.endswith("some-pipe")


# ---------------------------------------------------------------------------
# The handshake, against a fake stream
# ---------------------------------------------------------------------------


class FakeStream:
    """A duplex stream that records what was written and replays a script."""

    def __init__(self, replies: list[bytes]) -> None:
        self.written = bytearray()
        self._pending = bytearray(b"".join(replies))
        self.closed = False

    def write(self, data: bytes) -> int:
        if self.closed:
            raise OSError("stream is closed")
        self.written += data
        return len(data)

    def flush(self) -> None:
        if self.closed:
            raise OSError("stream is closed")

    def read(self, size: int) -> bytes:
        out = bytes(self._pending[:size])
        del self._pending[:size]
        return out

    def close(self) -> None:
        self.closed = True

    # Convenience for assertions.
    def lines(self) -> list[dict]:
        return [
            json.loads(line)
            for line in bytes(self.written).decode("utf-8").splitlines()
            if line
        ]


def paired_stream() -> FakeStream:
    return FakeStream([b'{"type":"paired"}\n'])


def connected_to(stream: FakeStream, monkeypatch: pytest.MonkeyPatch) -> ControlBridge:
    client = ControlBridge("test-pipe", "the-token")
    monkeypatch.setattr(client, "_connect", lambda: stream)
    return client


def test_it_pairs_before_it_sends_anything(monkeypatch: pytest.MonkeyPatch) -> None:
    stream = paired_stream()
    client = connected_to(stream, monkeypatch)

    client.send({"action": "reset_view"})

    first, second = stream.lines()
    assert first == {"type": "pair", "token": "the-token"}
    assert second["type"] == "scene_command"
    assert second["command"] == {"action": "reset_view"}


def test_the_client_does_not_choose_a_request_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # It would be ignored — the application stamps its own — but sending one
    # would suggest a client could dress a bridge frame up as a chat turn.
    stream = paired_stream()
    client = connected_to(stream, monkeypatch)

    client.send({"action": "reset_view"})

    assert "request_id" not in stream.lines()[1]


def test_one_connection_serves_many_commands(monkeypatch: pytest.MonkeyPatch) -> None:
    # The bridge admits one client at a time, so reconnecting per command would
    # mean racing itself for the pipe and re-pairing every time.
    stream = paired_stream()
    client = connected_to(stream, monkeypatch)

    client.send({"action": "reset_view"})
    client.send({"action": "clear_pathway"})

    sent = stream.lines()
    assert len(sent) == 3, "paired more than once"
    assert [frame["type"] for frame in sent] == ["pair", "scene_command", "scene_command"]


def test_silence_after_pairing_is_reported_as_a_stale_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The application writes a refusal and disconnects, and those race: the
    # client usually sees nothing at all. Reporting "no answer" would send the
    # reader looking for a network problem they do not have.
    stream = FakeStream([])
    client = connected_to(stream, monkeypatch)

    with pytest.raises(BridgeRefused) as raised:
        client.send({"action": "reset_view"})

    assert "token" in str(raised.value).lower()
    assert stream.closed


def test_a_refusal_that_does_arrive_is_passed_on(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stream = FakeStream([b'{"type":"refused","reason":"that token does not match"}\n'])
    client = connected_to(stream, monkeypatch)

    with pytest.raises(BridgeRefused) as raised:
        client.send({"action": "reset_view"})

    assert "does not match" in str(raised.value)


def test_an_unreadable_answer_is_not_treated_as_a_refusal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Different fault, different sentence: a reader who is told their token is
    # stale will go and copy a fresh one, which fixes nothing here.
    stream = FakeStream([b"not json at all\n"])
    client = connected_to(stream, monkeypatch)

    with pytest.raises(BridgeUnavailable):
        client.send({"action": "reset_view"})


def test_a_restarted_application_costs_one_reconnection_not_an_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # An application restarted between two commands is ordinary. Making every
    # tool distinguish that from a real failure would put a reconnect loop in
    # fifteen places.
    dead, alive = FakeStream([]), paired_stream()
    dead.close()

    client = ControlBridge("test-pipe", "the-token")
    # Only the replacement is handed out: `dead` is already in place, standing
    # for a connection that was live when the last command went through.
    monkeypatch.setattr(client, "_connect", lambda: alive)
    client._stream = dead

    client.send({"action": "reset_view"})

    assert [frame["type"] for frame in alive.lines()] == ["pair", "scene_command"]


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
        server.reply(b'{"type":"paired"}\n')

        client = ControlBridge(server.name, "the-token")
        client.send({"action": "set_layer_visibility", "system": "skeletal", "visible": False})
        # Waited for rather than read straight away: `send` returns once the
        # bytes are written, which is before this side has read them.
        received = server.wait_for_lines(2)
        client.close()

    assert json.loads(received[0]) == {"type": "pair", "token": "the-token"}
    second = json.loads(received[1])
    assert second["type"] == "scene_command"
    assert second["command"]["system"] == "skeletal"


@windows_only
def test_a_pipe_nobody_is_serving_says_to_open_the_application() -> None:
    client = ControlBridge("anatria3d-control-no-such-pipe-here", "t")
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
            client = ControlBridge(server.name, "the-token")
            client.send({"action": "reset_view"})
            waited = time.monotonic() - started
            server.wait_for_lines(2)
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
