import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { GuideOverlay } from "./GuideOverlay";

/**
 * The regulatory panel is read by people deciding whether to trust the tool, so
 * what it says is held here: it names each regulation, it never calls itself a
 * certificate, and the guide never understates what leaves the machine.
 */

beforeAll(() => {
  // The guide tracks the section in view; jsdom has no layout to observe.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

const text = () => document.body.textContent ?? "";

describe("GuideOverlay, regulatory transparency", () => {
  it("names each regulation it answers to", () => {
    render(<GuideOverlay onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "Regulatory transparency" })).toBeTruthy();
    expect(text()).toContain("Regulation (EU) 2024/1689");
    expect(text()).toContain("Regulation (EU) 2017/745 (MDR)");
    expect(text()).toContain("Regulation (EU) 2016/679");
  });

  it("is a statement, never a claim of certification", () => {
    render(<GuideOverlay onClose={() => {}} />);
    expect(text()).toContain("not a certificate");
    expect(text()).not.toMatch(/certified|CE[- ]marked medical device|compliance certificate/i);
  });

  it("says that a case drill's file is sent to the provider", () => {
    render(<GuideOverlay onClose={() => {}} />);
    expect(text()).toContain("the whole file is sent to your AI provider");
    expect(text()).not.toContain("the only thing that ever leaves is the question");
  });
});

describe("GuideOverlay, the local model", () => {
  it("says what has to be installed, and that the app does not do it", () => {
    render(<GuideOverlay onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "A model on your own computer" })).toBeTruthy();
    expect(text()).toContain("Anatria3D does not include a model and will not download one");
    expect(text()).toContain("ollama pull gemma3:4b");
  });

  it("states every limit a reader could otherwise assume away", () => {
    render(<GuideOverlay onClose={() => {}} />);
    expect(text()).toContain("It has no tools");
    expect(text()).toContain("not saved to your journal");
    expect(text()).toContain("Local models make more mistakes than the large ones");
    expect(text()).toContain("Ollama also offers models that run on its servers");
    expect(text()).toContain("a button means the name is real, not that what was said about it is true");
  });

  it("never lets a small model inherit the assistant's promise to decline", () => {
    render(<GuideOverlay onClose={() => {}} />);
    expect(text()).toContain("A question about a real person gets a fixed notice, not an answer");
    expect(text()).toContain("so it is not a guarantee");
    expect(text()).toContain("Because a small model keeps it less reliably");
    expect(text()).toContain("It is a model on your computer, not a safeguard");
  });

  it("says plainly where a local conversation goes", () => {
    render(<GuideOverlay onClose={() => {}} />);
    expect(text()).toContain("go to Ollama on this computer, at its local address, and to nowhere else");
    expect(text()).toContain("Models that run on Ollama's servers are refused");
  });
});

describe("GuideOverlay, contact", () => {
  it("prints the address and copies it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<GuideOverlay onClose={() => {}} />);
    expect(screen.getAllByText("anatria@digitalrose.org").length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("anatria@digitalrose.org"));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });
});

describe("GuideOverlay, licensing", () => {
  it("states the licence, what is free, and when it converts", () => {
    render(<GuideOverlay onClose={() => {}} />);
    expect(text()).toContain("Business Source License 1.1");
    // The date itself lives only in LICENSE, where the release procedure moves it.
    expect(text()).toContain("four years after its release");
    expect(text()).not.toMatch(/\b20\d\d-\d\d-\d\d\b|\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December) 20\d\d/);
    expect(text()).toMatch(/commercial agreement/i);
  });

  it("never claims the application's licence covers the anatomy", () => {
    render(<GuideOverlay onClose={() => {}} />);
    expect(text()).toContain("does not reach the anatomy");
    expect(text()).not.toMatch(/source code is released under the Apache/i);
  });
});
