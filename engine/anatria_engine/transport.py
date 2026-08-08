"""NDJSON transport over stdin/stdout.

The sidecar speaks newline-delimited JSON on stdio rather than serving HTTP on
localhost. That is a security decision, not a stylistic one: a localhost port is
reachable by any other process on the machine, and this process holds the
user's API keys. stdio has no such surface — only our parent Rust process can
talk to it.

stdout carries protocol frames only. Anything diagnostic goes to stderr, which
Rust logs separately; a stray `print()` would corrupt the stream.
"""

from __future__ import annotations

import asyncio
import json
import queue
import sys
import threading
from collections.abc import AsyncIterator
from typing import Any

from pydantic import BaseModel

# Sentinel pushed onto the queue when stdin closes (parent process went away).
_EOF = object()


class Transport:
    """Writes protocol frames to stdout.

    `emit` is safe to call from any thread and from multiple concurrent tasks:
    the lock guarantees whole lines, so two interleaved streaming responses
    cannot produce a torn JSON frame.
    """

    def __init__(self, stream: Any = None) -> None:
        self._stream = stream if stream is not None else sys.stdout
        self._lock = threading.Lock()

    def emit(self, event: BaseModel) -> None:
        # `exclude_none=False` keeps nullable fields present, so the Rust and
        # TypeScript discriminated unions always see the shape they expect.
        line = event.model_dump_json()
        with self._lock:
            self._stream.write(line + "\n")
            self._stream.flush()

    def log(self, message: str) -> None:
        """Diagnostics go to stderr — never stdout."""
        print(message, file=sys.stderr, flush=True)


class StdinReader:
    """Yields stdin lines without blocking the event loop, and stops on demand.

    A dedicated reader thread feeds a queue rather than using
    `loop.connect_read_pipe`, which is unavailable for stdin on Windows'
    Proactor event loop. One code path across all three platforms.

    `stop()` is not optional politeness. The consumer waits on the queue inside
    `asyncio.to_thread`, i.e. on a default-executor worker, and `asyncio.run`
    joins those workers on the way out. Without a sentinel to unblock that
    `get`, a shutdown request would hang the interpreter with a live worker
    parked on an empty queue — the process would have to be killed, which is
    precisely the orphaned-engine outcome this design exists to avoid.
    """

    def __init__(self) -> None:
        self._queue: queue.Queue[Any] = queue.Queue()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(
            target=self._pump, name="stdin-reader", daemon=True
        )
        self._thread.start()

    def _pump(self) -> None:
        try:
            for line in sys.stdin:
                self._queue.put(line)
        except Exception:  # pragma: no cover - stdin torn down mid-read
            pass
        finally:
            self._queue.put(_EOF)

    def stop(self) -> None:
        """Unblock a pending `get`. Safe to call more than once."""
        self._queue.put(_EOF)

    async def lines(self) -> AsyncIterator[str]:
        self.start()
        while True:
            item = await asyncio.to_thread(self._queue.get)
            if item is _EOF:
                return
            line = item.strip()
            if line:
                yield line


def parse_json_line(line: str) -> dict[str, Any] | None:
    """Parse one frame, returning None when it is not a JSON object."""
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None
