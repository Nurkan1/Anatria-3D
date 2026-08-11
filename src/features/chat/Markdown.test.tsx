import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useSceneStore } from "@/stores/sceneStore";

import { Markdown } from "./Markdown";

afterEach(cleanup);

describe("Markdown", () => {
  it("renders the structure the model teaches with", () => {
    render(
      <Markdown>{`## Pathophysiology\n\n- **Preload** rises\n- Wall stress follows`}</Markdown>,
    );

    expect(screen.getByText("Pathophysiology")).toBeDefined();
    expect(screen.getByText("Preload").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders tables, which clinician answers lean on", () => {
    render(
      <Markdown>{`| Finding | Value |\n| --- | --- |\n| EF | 35% |`}</Markdown>,
    );

    expect(screen.getByRole("table")).toBeDefined();
    expect(screen.getByText("35%")).toBeDefined();
  });

  it("does not execute raw HTML from model output", () => {
    // Model output is untrusted input rendered inside the app's own webview.
    // `react-markdown` ignores raw HTML unless rehype-raw is added; this test
    // exists so nobody adds it without noticing what it opens up.
    const { container } = render(
      <Markdown>{`<img src=x onerror="window.__pwned = true">`}</Markdown>,
    );

    expect(container.querySelector("img")).toBeNull();
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it("makes a numbered reference a control, not decoration", () => {
    // The regression this exists for, and it was silent for a long time.
    // react-markdown rewrites any href whose scheme is not on its allow-list to
    // the empty string, so `anatria-ref:` arrived blank, the branch that builds
    // the pin never matched, and every number in every answer rendered as inert
    // blue text. Nothing threw. The feature was simply dead, and the only way
    // to reach a structure was to scroll past the whole answer to the chips.
    useSceneStore.setState({
      organs: {
        hippocampus: {
          organ_id: "hippocampus",
          ta2_latin: "Hippocampus",
          name_en: "Hippocampus",
          system: "nervous",
          mesh_file: "nervous_male.glb",
          node: "Hippocampus",
          path: [],
        },
      },
    });

    render(<Markdown>{`The hippocampus [[hippocampus]] stores the map.`}</Markdown>);

    const pin = screen.getByRole("button", { name: /hippocampus/i });
    expect(pin.textContent).toBe("1");
  });

  it("still strips a dangerous scheme the model wrote", () => {
    // The pin's exemption is for one prefix nothing outside `organRefs.ts` can
    // produce. Everything else keeps going through react-markdown's sanitiser,
    // and this is what proves the exemption did not become a hole.
    const { container } = render(
      <Markdown>{`[run](javascript:window.__pwned=true)`}</Markdown>,
    );

    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it("renders model links as inert text", () => {
    // A clickable link in model output could navigate the app shell away from
    // itself, and there is no back button in a desktop window.
    const { container } = render(
      <Markdown>{`See [the guide](https://example.invalid/x)`}</Markdown>,
    );

    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText("the guide")).toBeDefined();
  });
});
