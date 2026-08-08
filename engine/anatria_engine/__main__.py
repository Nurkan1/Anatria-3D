"""Sidecar entry point: read requests on stdin, stream events on stdout.

Lifecycle is owned by the Rust side. This process emits a `ready` frame once
booted, then serves requests until stdin closes or a `shutdown` frame arrives.
Requests run as concurrent tasks so a long agent turn never blocks a cancel.
"""

from __future__ import annotations

import asyncio
import sys

from pydantic import TypeAdapter, ValidationError

from anatria_engine.protocol import (
    AgentRequest,
    CancelRequest,
    EngineRequest,
    ErrorEvent,
    ListModelsRequest,
    ReadyEvent,
    ShutdownRequest,
)
from anatria_engine.transport import StdinReader, Transport, parse_json_line

_request_adapter: TypeAdapter[EngineRequest] = TypeAdapter(EngineRequest)

# How long in-flight requests may keep running after stdin closes or a
# `shutdown` frame arrives. See `Engine._drain`.
_DRAIN_GRACE_SECONDS = 10.0


class Engine:
    def __init__(self, transport: Transport) -> None:
        self._transport = transport
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._shutdown = asyncio.Event()
        self._reader = StdinReader()

    async def serve(self) -> None:
        self._transport.emit(ReadyEvent.current())

        async for line in self._reader.lines():
            self._handle_line(line)
            # Checked *after* handling: the frame that sets the flag is the
            # shutdown frame itself, and testing before would leave us waiting
            # on a line that is never coming.
            if self._shutdown.is_set():
                self._reader.stop()
                break

        await self._drain()

    # -- frame dispatch ----------------------------------------------------

    def _handle_line(self, line: str) -> None:
        payload = parse_json_line(line)
        if payload is None:
            self._transport.emit(
                ErrorEvent(
                    request_id=None,
                    code="invalid_request",
                    message="Malformed JSON frame on stdin.",
                )
            )
            return

        try:
            request = _request_adapter.validate_python(payload)
        except ValidationError as exc:
            # `request_id` may be absent or itself invalid; report what we can
            # so the frontend can settle the pending turn rather than hang.
            raw_id = payload.get("request_id")
            self._transport.emit(
                ErrorEvent(
                    request_id=raw_id if isinstance(raw_id, str) else None,
                    code="invalid_request",
                    message=_summarise_validation_error(exc),
                )
            )
            return

        match request:
            case ShutdownRequest():
                self._shutdown.set()
            case CancelRequest():
                self._cancel(request.request_id)
            case AgentRequest() | ListModelsRequest():
                self._spawn(request)

    def _spawn(self, request: AgentRequest | ListModelsRequest) -> None:
        request_id = request.request_id
        if request_id in self._tasks:
            self._transport.emit(
                ErrorEvent(
                    request_id=request_id,
                    code="invalid_request",
                    message=f"request_id {request_id!r} is already in flight.",
                )
            )
            return

        task = asyncio.create_task(self._run(request), name=f"request:{request_id}")
        self._tasks[request_id] = task
        task.add_done_callback(lambda _t, rid=request_id: self._tasks.pop(rid, None))

    def _cancel(self, request_id: str) -> None:
        task = self._tasks.get(request_id)
        if task is not None:
            task.cancel()

    async def _run(self, request: AgentRequest | ListModelsRequest) -> None:
        try:
            # Imported lazily, and *inside* the guard: the whole point is that a
            # broken provider SDK becomes an error event on the request that
            # triggered it. Importing above the try would let an ImportError
            # escape as an unretrieved task exception — the request would simply
            # hang, with the reason only on stderr.
            from anatria_engine.handlers import (
                handle_agent_request,
                handle_list_models,
            )

            if isinstance(request, AgentRequest):
                await handle_agent_request(request, self._transport)
            else:
                await handle_list_models(request, self._transport)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self._transport.log(f"unhandled error in {request.request_id}: {exc!r}")
            self._transport.emit(
                ErrorEvent(
                    request_id=request.request_id,
                    code="internal_error",
                    message=str(exc),
                )
            )

    async def _drain(self) -> None:
        """Let in-flight requests finish, briefly, then cancel the stragglers.

        Both exit paths land here: an explicit `shutdown` frame and stdin EOF.
        Cancelling immediately would drop a response the user is already
        reading, and would make the engine impossible to drive from a one-shot
        pipe (EOF arrives the instant the last frame is written, long before
        the request it started has finished).

        The grace window is not a shutdown delay in practice — Rust kills the
        child on window close, so this only ever runs to completion in tests
        and in the rare case where the parent closes stdin but stays alive.
        """
        if not self._tasks:
            return

        pending = list(self._tasks.values())
        _done, still_running = await asyncio.wait(pending, timeout=_DRAIN_GRACE_SECONDS)

        for task in still_running:
            task.cancel()
        if still_running:
            await asyncio.gather(*still_running, return_exceptions=True)


def _summarise_validation_error(exc: ValidationError) -> str:
    """Compact one-line summary — the full Pydantic dump is stderr material."""
    parts = []
    for err in exc.errors()[:5]:
        location = ".".join(str(p) for p in err["loc"]) or "<root>"
        parts.append(f"{location}: {err['msg']}")
    return "; ".join(parts)


def _force_utf8_stdio() -> None:
    """Pin stdio to UTF-8.

    Python on Windows still defaults stdio to the ANSI code page (cp1252 on a
    typical machine), which cannot encode Cyrillic. Bulgarian is the primary
    target locale, so leaving this to the platform default would corrupt every
    BG label the moment it crossed the pipe. `errors="strict"` is deliberate:
    a mangled frame should fail loudly, not silently ship mojibake to the UI.
    """
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="strict")


def main() -> int:
    _force_utf8_stdio()
    transport = Transport()
    try:
        asyncio.run(Engine(transport).serve())
    except KeyboardInterrupt:
        return 0
    except Exception as exc:
        transport.emit(
            ErrorEvent(request_id=None, code="internal_error", message=str(exc))
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
