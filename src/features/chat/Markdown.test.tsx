import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

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
