"""Build a Pydantic AI model for the provider the user picked.

Keys arrive per request, injected by Rust from the OS keyring, and are passed
straight to the provider object. Nothing is written to `os.environ`: the engine
serves requests concurrently and may see different keys for different providers,
so process-global credential state would be both a leak and a race.
"""

from __future__ import annotations

from pydantic_ai.models import Model

from anatria_engine.model_capability import endpoint_for
from anatria_engine.protocol import AiProvider

# Starting point only — the settings drawer lists what the key can actually
# reach and the choice is sent per request. Preview models are avoided as
# defaults: they are the ones that answer 503 under load, and a first-run
# failure reads as "the app is broken" rather than "that model is busy".
DEFAULT_MODELS: dict[AiProvider, str] = {
    "anthropic": "claude-sonnet-5",
    "openai": "gpt-5.2",
    "google": "gemini-3.1-flash-lite",
}


class ProviderError(RuntimeError):
    """The provider SDK could not be initialised for this request."""


def resolve_model_name(provider: AiProvider, model: str | None) -> str:
    """The model id actually sent to the SDK, once the default is applied.

    Split out so the answer can be reported back with the turn. A usage record
    filed against "whatever the panel had selected" would say `null` for every
    turn that took the default, and a consumption panel that cannot name the
    model it is counting is worse than none — it invites the reader to attribute
    the spend to the wrong one.
    """
    return model or DEFAULT_MODELS[provider]


def build_model(provider: AiProvider, api_key: str, model: str | None = None) -> Model:
    name = resolve_model_name(provider, model)

    try:
        if provider == "anthropic":
            from pydantic_ai.models.anthropic import AnthropicModel
            from pydantic_ai.providers.anthropic import AnthropicProvider

            return AnthropicModel(name, provider=AnthropicProvider(api_key=api_key))

        if provider == "openai":
            from pydantic_ai.providers.openai import OpenAIProvider

            if endpoint_for("openai", name) == "responses":
                from pydantic_ai.models.openai import (
                    OpenAIResponsesModel,
                    OpenAIResponsesModelSettings,
                )

                return OpenAIResponsesModel(
                    name,
                    provider=OpenAIProvider(api_key=api_key),
                    # The Responses API keeps conversation state server-side by
                    # default. Anatria3D owns its history — `build_history`
                    # replays prior turns deliberately, and the journal is the
                    # record — so storing a second copy on OpenAI's side would
                    # put the reader's questions somewhere this application
                    # does not manage and cannot delete.
                    settings=OpenAIResponsesModelSettings(openai_store=False),
                )

            from pydantic_ai.models.openai import OpenAIChatModel

            return OpenAIChatModel(name, provider=OpenAIProvider(api_key=api_key))

        from pydantic_ai.models.google import GoogleModel
        from pydantic_ai.providers.google import GoogleProvider

        return GoogleModel(name, provider=GoogleProvider(api_key=api_key))

    except ImportError as exc:  # pragma: no cover - packaging failure, not logic
        raise ProviderError(
            f"The {provider} integration is missing from this build: {exc}"
        ) from exc
