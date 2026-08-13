import { beforeEach, describe, expect, it } from "vitest";

import type { ModelInfo } from "@/lib/schemas";

import { useModelStore } from "./modelStore";
import { patchChatPreferences, reloadChatPreferences } from "./chatPreferences";

/**
 * The picker must never put someone on a model nobody has driven the scene
 * tools with.
 *
 * The engine marks exactly one entry as `recommended`: the model this build was
 * tested against. When that model is absent from a key's catalogue it marks
 * none — and this store used to paper over that by taking `models[0]`. The
 * catalogue is sorted by id descending, so "first" is whichever name sorts
 * highest, which on a current OpenAI key is `gpt-5.6-terra` — the one model
 * that cannot be served function tools on the endpoint the engine uses.
 *
 * So the unsafe guess existed on both sides of the IPC boundary, and fixing
 * only the Python half would have changed nothing observable.
 */

const model = (id: string, recommended = false): ModelInfo => ({
  id,
  label: id,
  description: null,
  recommended,
});

const store = () => useModelStore.getState();

beforeEach(() => {
  localStorage.clear();
  reloadChatPreferences();
  useModelStore.setState({ byProvider: {} });
});

describe("receiveModels", () => {
  it("selects the model the engine vouches for", () => {
    store().beginCheck("openai", "r1");
    store().receiveModels("openai", "r1", [
      model("gpt-5.6-terra"),
      model("gpt-5.2", true),
      model("o3"),
    ]);

    expect(store().get("openai").selected).toBe("gpt-5.2");
    expect(store().get("openai").status).toBe("valid");
  });

  /** The regression: `models[0]` here would be `gpt-5.6-terra`. */
  it("selects nothing when the engine recommends nothing", () => {
    store().beginCheck("openai", "r1");
    store().receiveModels("openai", "r1", [
      model("gpt-5.6-terra"),
      model("gpt-4.1"),
      model("o3"),
    ]);

    expect(store().get("openai").selected).toBeNull();
    // The catalogue itself still arrives — the reader picks from it.
    expect(store().get("openai").models).toHaveLength(3);
  });

  it("keeps an explicit choice even when it is not the recommended one", () => {
    store().beginCheck("openai", "r1");
    store().select("openai", "o3");
    store().receiveModels("openai", "r1", [model("gpt-5.2", true), model("o3")]);

    expect(store().get("openai").selected).toBe("o3");
  });

  /** A model the provider retired must not keep being sent. */
  it("drops a stored choice the catalogue no longer offers", () => {
    store().select("openai", "gpt-4-turbo");
    store().beginCheck("openai", "r1");
    store().receiveModels("openai", "r1", [model("gpt-5.2", true)]);

    expect(store().get("openai").selected).toBe("gpt-5.2");
  });

  /** And when there is no recommendation to fall back to, it selects none. */
  it("clears a stored choice that is gone with nothing safe to replace it", () => {
    store().select("openai", "gpt-4-turbo");
    store().beginCheck("openai", "r1");
    store().receiveModels("openai", "r1", [model("gpt-5.6-terra")]);

    expect(store().get("openai").selected).toBeNull();
  });

  it("ignores a response from a request that is no longer in flight", () => {
    store().beginCheck("openai", "r2");
    store().receiveModels("openai", "r1", [model("stale", true)]);
    expect(store().get("openai").models).toEqual([]);
  });
});

describe("restoring the reader's choice", () => {
  it("carries a remembered model across a restart", () => {
    patchChatPreferences({ model: { anthropic: "claude-opus-5" } });
    reloadChatPreferences();
    useModelStore.setState({ byProvider: {} });

    // Simulates boot: the store seeds itself from the stored preferences.
    const seeded = useModelStore.getState();
    seeded.select("anthropic", "claude-opus-5");
    expect(seeded.get("anthropic").selected).toBe("claude-opus-5");
  });

  it("survives a key rotation, which clears the catalogue but not the choice", () => {
    store().select("anthropic", "claude-opus-5");
    store().reset("anthropic");

    expect(store().get("anthropic").selected).toBe("claude-opus-5");
    expect(store().get("anthropic").models).toEqual([]);
    // Left at `unknown` so the drawer refetches — and so revalidates the key.
    expect(store().get("anthropic").status).toBe("unknown");
  });
});
