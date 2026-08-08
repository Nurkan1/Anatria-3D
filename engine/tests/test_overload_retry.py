"""A saturated model is a transient condition, not a failed request.

Providers answer HTTP 503 when a model is momentarily oversubscribed. Retrying
usually works — but only while nothing has reached the screen yet. Once text is
streaming, a retry would replay the answer from the top and the reader would
watch it stutter, so the turn has to fail cleanly instead.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest

from anatria_engine import handlers
from anatria_engine.agent import TextChunk
from anatria_engine.protocol import AgentRequest, OrganMeta
from anatria_engine.transport import Transport


class Recorder(Transport):
    """Captures emitted frames instead of writing them to stdout."""

    def __init__(self) -> None:
        self.events: list = []
        self.logs: list[str] = []

    def emit(self, event) -> None:  # type: ignore[override]
        self.events.append(event)

    def log(self, message: str) -> None:  # type: ignore[override]
        self.logs.append(message)

    def kinds(self) -> list[str]:
        return [getattr(event, "type", "?") for event in self.events]


class OverloadedError(Exception):
    def __str__(self) -> str:
        return "status_code: 503, body: {'error': {'status': 'UNAVAILABLE'}}"


def make_request() -> AgentRequest:
    return AgentRequest(
        request_id="r1",
        query="How does the heart pump blood?",
        history=[],
        provider="google",
        profile="student",
        language="en",
        gender_model="male",
        mode="tutor",
        selection=[],
        available_organs=[
            OrganMeta(
                organ_id="left_ventricle",
                ta2_latin="Ventriculus sinister",
                name_en="Left ventricle",
                system="cardiovascular",
            )
        ],
        api_key="not-a-real-key",
    )


@pytest.fixture(autouse=True)
def _no_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep the retry timing out of the test runtime."""
    monkeypatch.setattr(handlers, "_OVERLOAD_BACKOFF_SECONDS", (0.0, 0.0))


async def test_retries_a_saturated_model_and_then_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempts = 0

    async def flaky(_request, _scene) -> AsyncIterator:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise OverloadedError()
        yield TextChunk("The left ventricle ejects blood.")

    monkeypatch.setattr(handlers, "run_agent", flaky)
    transport = Recorder()

    await handlers.handle_agent_request(make_request(), transport)

    assert attempts == 2
    assert "text_delta" in transport.kinds()
    assert "error" not in transport.kinds()


async def test_gives_up_with_an_actionable_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def always_busy(_request, _scene) -> AsyncIterator:
        raise OverloadedError()
        yield  # pragma: no cover - unreachable, keeps this an async generator

    monkeypatch.setattr(handlers, "run_agent", always_busy)
    transport = Recorder()

    await handlers.handle_agent_request(make_request(), transport)

    errors = [e for e in transport.events if getattr(e, "type", None) == "error"]
    assert len(errors) == 1
    assert errors[0].code == "service_unavailable"
    # The user's move is to switch model or wait; the message has to say so,
    # and has to rule out the thing they will otherwise suspect first.
    assert "Settings" in errors[0].message
    assert "key is fine" in errors[0].message


async def test_does_not_retry_once_text_has_been_shown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempts = 0

    async def fails_midway(_request, _scene) -> AsyncIterator:
        nonlocal attempts
        attempts += 1
        yield TextChunk("The left ventricle ")
        raise OverloadedError()

    monkeypatch.setattr(handlers, "run_agent", fails_midway)
    transport = Recorder()

    await handlers.handle_agent_request(make_request(), transport)

    # Retrying here would restart the answer the reader is already reading.
    assert attempts == 1
    assert transport.kinds().count("text_delta") == 1
    assert "error" in transport.kinds()


async def test_other_failures_are_not_retried(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts = 0

    async def bad_key(_request, _scene) -> AsyncIterator:
        nonlocal attempts
        attempts += 1
        raise RuntimeError("Error code: 401 - invalid x-api-key")
        yield  # pragma: no cover

    monkeypatch.setattr(handlers, "run_agent", bad_key)
    transport = Recorder()

    await handlers.handle_agent_request(make_request(), transport)

    # A rejected key will be rejected just as fast the second time.
    assert attempts == 1
    errors = [e for e in transport.events if getattr(e, "type", None) == "error"]
    assert errors[0].code == "invalid_api_key"
