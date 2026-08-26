"""A named-pipe server for the bridge client's tests. Windows only.

Not a reimplementation of the application's side — that is Rust, and it is
tested there. This is the smallest thing that will hold a real kernel pipe
object open so the client can be pointed at one, because the questions worth
asking of a pipe client are the ones a mock answers by assumption: does `open`
reach it, and are the bytes written the bytes read.

Deliberately built with `ctypes` rather than a dependency. This lives in a
virtualenv the project asks a reader to create by hand, and a test helper is a
poor reason to add a package to that instruction.
"""

from __future__ import annotations

import ctypes
import os
import threading
import time
from ctypes import wintypes
from typing import Self

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

PIPE_ACCESS_DUPLEX = 0x00000003
# Byte mode throughout, matching the application: a message-mode pipe would
# frame for us, and the protocol is newline-delimited precisely so it does not
# depend on that.
PIPE_TYPE_BYTE = 0x00000000
PIPE_READMODE_BYTE = 0x00000000
PIPE_WAIT = 0x00000000
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

#: A client that connected between CreateNamedPipeW and ConnectNamedPipe is
#: already attached, which the call reports as a failure.
ERROR_PIPE_CONNECTED = 535

BUFFER = 64 * 1024

kernel32.CreateNamedPipeW.restype = wintypes.HANDLE
kernel32.CreateNamedPipeW.argtypes = [
    wintypes.LPCWSTR,
    wintypes.DWORD,
    wintypes.DWORD,
    wintypes.DWORD,
    wintypes.DWORD,
    wintypes.DWORD,
    wintypes.DWORD,
    ctypes.c_void_p,
]
kernel32.ConnectNamedPipe.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
kernel32.CancelIoEx.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
kernel32.DisconnectNamedPipe.argtypes = [wintypes.HANDLE]
kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
kernel32.ReadFile.argtypes = [
    wintypes.HANDLE,
    ctypes.c_void_p,
    wintypes.DWORD,
    ctypes.POINTER(wintypes.DWORD),
    ctypes.c_void_p,
]
kernel32.WriteFile.argtypes = [
    wintypes.HANDLE,
    ctypes.c_void_p,
    wintypes.DWORD,
    ctypes.POINTER(wintypes.DWORD),
    ctypes.c_void_p,
]


class FakePipeServer:
    """One pipe, one instance, serving connections until it is closed.

    Serves them in a loop rather than one and done, because a client that has
    to wait out a busy pipe is a case worth testing and that needs the server
    to come back round to accepting.
    """

    def __init__(self) -> None:
        # Unique per run: a leftover from a crashed test must not make the next
        # one fail with a name collision, and two runs may overlap.
        self.name = f"anatria3d-test-{os.getpid()}-{time.monotonic_ns()}"
        self.full_name = rf"\\.\pipe\{self.name}"
        self._replies: list[bytes] = []
        self._received = bytearray()
        self._lock = threading.Lock()
        self._stopping = threading.Event()

        self._handle = kernel32.CreateNamedPipeW(
            self.full_name,
            PIPE_ACCESS_DUPLEX,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
            1,
            BUFFER,
            BUFFER,
            0,
            None,
        )
        if self._handle == INVALID_HANDLE_VALUE:
            raise OSError(ctypes.get_last_error(), "could not create the test pipe")

        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()

    def reply(self, line: bytes) -> None:
        """Queue one line to send back, in order, as lines arrive."""
        with self._lock:
            self._replies.append(line)

    def lines(self) -> list[str]:
        """Everything received so far, split on newlines."""
        with self._lock:
            return bytes(self._received).decode("utf-8").splitlines()

    def wait_for_lines(self, count: int, timeout: float = 5.0) -> list[str]:
        """Block until `count` lines have arrived, then return them.

        The client returns from `send` as soon as the bytes are written, which
        is before this side has read them. Asserting on `lines()` straight
        afterwards is a race that passes on a quiet machine and fails on a busy
        one — the worst kind, because it fails in CI and not here.
        """
        deadline = time.monotonic() + timeout
        while True:
            found = self.lines()
            if len(found) >= count:
                return found
            if time.monotonic() >= deadline:
                raise AssertionError(
                    f"waited {timeout}s for {count} lines, saw {len(found)}: {found}"
                )
            time.sleep(0.01)

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        """Stop the thread, in the two steps the application itself uses.

        `CancelIoEx` first, because the thread can be blocked in either of two
        places and the flag reaches neither: a `ReadFile` waiting on a client
        that has gone quiet, or a `ConnectNamedPipe` waiting for one to arrive.
        Then a throwaway connection, in case there was nothing pending to
        cancel at the instant we asked.

        Getting this wrong does not merely leak a thread. `CloseHandle` on a
        handle with a synchronous read still pending **blocks as well**, so the
        version without the cancel hung the whole suite instead of failing one
        test — which is how it was found.
        """
        self._stopping.set()
        kernel32.CancelIoEx(self._handle, None)
        try:
            with open(self.full_name, "r+b", buffering=0):
                pass
        except OSError:
            # Already gone, or busy with a client that is about to leave.
            # Either way the thread is not parked on an empty pipe.
            pass
        self._thread.join(timeout=5)
        kernel32.CloseHandle(self._handle)

    # ------------------------------------------------------------------

    def _serve(self) -> None:
        while not self._stopping.is_set():
            connected = kernel32.ConnectNamedPipe(self._handle, None)
            if not connected and ctypes.get_last_error() not in (
                ERROR_PIPE_CONNECTED,
                0,
            ):
                break
            if self._stopping.is_set():
                break

            self._converse()
            kernel32.DisconnectNamedPipe(self._handle)

    def _converse(self) -> None:
        """Read lines from one client, answering each with the next reply."""
        pending = bytearray()
        while not self._stopping.is_set():
            chunk = self._read()
            if chunk is None:
                return
            pending += chunk

            while b"\n" in pending:
                line, _, rest = pending.partition(b"\n")
                pending = bytearray(rest)
                with self._lock:
                    self._received += line + b"\n"
                    answer = self._replies.pop(0) if self._replies else None
                if answer is not None:
                    self._write(answer)

    def _read(self) -> bytes | None:
        buffer = ctypes.create_string_buffer(BUFFER)
        read = wintypes.DWORD(0)
        ok = kernel32.ReadFile(
            self._handle, buffer, BUFFER, ctypes.byref(read), None
        )
        if not ok or read.value == 0:
            return None
        return buffer.raw[: read.value]

    def _write(self, data: bytes) -> None:
        written = wintypes.DWORD(0)
        kernel32.WriteFile(self._handle, data, len(data), ctypes.byref(written), None)
