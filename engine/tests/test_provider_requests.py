"""Each provider's SDK builds and sends a real request, the way the app does it.

v0.7.0 shipped with every Claude turn failing ("Cannot instantiate typing.Union")
and all 378 tests passing. pydantic-ai 2.54.0 builds Anthropic messages with
`BetaMessageParam(...)`, which anthropic 2.0.0 turned into a Union, and nothing
here had ever built an Anthropic request: the other tests drive the agent with a
test model, which never touches a provider SDK.

So these go through `build_agent`, tools and instructions included, to a server
on the loopback address. Anthropic answers and the answer is parsed back, the
whole round trip. OpenAI and Google answer 401, which is enough to prove their
requests were built and sent: the failure this guards against happens before
anything reaches the network.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import ClassVar

import pytest
from pydantic_ai.exceptions import ModelHTTPError

from anatria_engine.agent import build_agent, build_scene_context
from anatria_engine.protocol import AgentRequest

ANTHROPIC_REPLY = {
    "id": "msg_test",
    "type": "message",
    "role": "assistant",
    "model": "claude-sonnet-5",
    "content": [{"type": "text", "text": "The left ventricle pumps blood into the aorta."}],
    "stop_reason": "end_turn",
    "stop_sequence": None,
    "usage": {"input_tokens": 12, "output_tokens": 9},
}


class _Provider(BaseHTTPRequestHandler):
    #: Requests received, set fresh by the fixture for each test.
    seen: ClassVar[list[tuple[str, dict]]] = []

    def do_POST(self) -> None:
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        self.seen.append((self.path, body))
        if self.path.startswith("/v1/messages") and body.get("stream"):
            self._stream_anthropic()
            return
        if self.path.startswith("/v1/messages"):
            status, reply = 200, ANTHROPIC_REPLY
        else:
            status = 401
            reply = {"error": {"code": 401, "message": "test key", "status": "UNAUTHENTICATED"}}
        data = json.dumps(reply).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _stream_anthropic(self) -> None:
        """The same answer as Anthropic streams it, which is how the app asks for it."""
        start = {**ANTHROPIC_REPLY, "content": [], "stop_reason": None}
        text = ANTHROPIC_REPLY["content"][0]["text"]
        events = [
            ("message_start", {"type": "message_start", "message": start}),
            ("content_block_start", {"type": "content_block_start", "index": 0,
                                     "content_block": {"type": "text", "text": ""}}),
            ("content_block_delta", {"type": "content_block_delta", "index": 0,
                                     "delta": {"type": "text_delta", "text": text}}),
            ("content_block_stop", {"type": "content_block_stop", "index": 0}),
            ("message_delta", {"type": "message_delta",
                               "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                               "usage": {"output_tokens": 9}}),
            ("message_stop", {"type": "message_stop"}),
        ]
        data = "".join(f"event: {name}\ndata: {json.dumps(event)}\n\n" for name, event in events)
        payload = data.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args: object) -> None:
        pass


@pytest.fixture
def server(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[tuple[str, dict]]]:
    """Point every provider the app builds at a server on this machine."""
    from pydantic_ai.providers import anthropic, google, openai

    httpd = HTTPServer(("127.0.0.1", 0), _Provider)
    url = f"http://127.0.0.1:{httpd.server_address[1]}"
    _Provider.seen = []
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    def pointed(cls, base_url: str):
        return lambda *args, **kwargs: cls(*args, base_url=base_url, **kwargs)

    monkeypatch.setattr(anthropic, "AnthropicProvider", pointed(anthropic.AnthropicProvider, url))
    monkeypatch.setattr(openai, "OpenAIProvider", pointed(openai.OpenAIProvider, f"{url}/v1"))
    monkeypatch.setattr(google, "GoogleProvider", pointed(google.GoogleProvider, url))
    try:
        yield _Provider.seen
    finally:
        httpd.shutdown()


def request(provider: str) -> AgentRequest:
    return AgentRequest.model_validate({
        "request_id": "test", "query": "What does the left ventricle do?", "history": [],
        "provider": provider, "profile": "student", "language": "en", "gender_model": "male",
        "mode": "tutor", "selection": [],
        "available_organs": [{
            "organ_id": "left_ventricle", "ta2_latin": "Ventriculus sinister",
            "name_en": "Left ventricle", "system": "cardiovascular",
        }],
        "api_key": "test-key",
    })


async def run(provider: str) -> str:
    turn = request(provider)
    scene = build_scene_context(turn, emit=lambda _event: None)
    result = await build_agent(turn, scene).run(turn.query, deps=scene)
    return result.output


async def test_a_claude_turn_is_built_sent_and_read_back(server) -> None:
    assert await run("anthropic") == "The left ventricle pumps blood into the aorta."
    path, body = server[-1]
    assert path.startswith("/v1/messages")
    assert body["messages"][0]["role"] == "user"
    assert body["tools"], "the scene tools went with it"


@pytest.mark.parametrize("provider", ["openai", "google"])
async def test_the_other_providers_build_and_send_a_request(server, provider: str) -> None:
    with pytest.raises(ModelHTTPError) as raised:
        await run(provider)
    assert raised.value.status_code == 401
    assert server, "nothing reached the server"
