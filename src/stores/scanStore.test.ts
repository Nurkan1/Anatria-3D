import { beforeEach, describe, expect, it } from "vitest";

import { scanIsStill, useScanStore } from "./scanStore";

const store = () => useScanStore.getState();

beforeEach(() => {
  useScanStore.setState({
    enabled: false,
    held: false,
    pinned: false,
    at: 0.5,
    sweepOnAnswer: true,
    tint: "cyan",
    reveal: false,
    readout: true,
    panel: true,
    ghost: false,
  });
  localStorage.clear();
});

describe("scanStore", () => {
  it("starts off, like every other switch that opens something", () => {
    expect(store().enabled).toBe(false);
  });

  it("lets go when it is switched off", () => {
    // Otherwise the next time it is switched on, an invisible hand is still
    // holding the light at somebody's ankle from a session nobody remembers.
    useScanStore.setState({ enabled: true });
    store().hold(0.1);
    expect(store().held).toBe(true);

    store().toggle();
    expect(store().enabled).toBe(false);
    expect(store().held).toBe(false);
  });

  it("takes hold where it is put", () => {
    store().hold(0.42);
    expect(store().held).toBe(true);
    expect(store().at).toBeCloseTo(0.42);
  });

  it("refuses a position outside the body it is sweeping", () => {
    // A slider cannot produce these, but the ring under a pointer will: a drag
    // that runs off the top of the model would otherwise park the light in
    // empty space and look like the scanner had broken.
    store().hold(9);
    expect(store().at).toBe(1);
    store().hold(-3);
    expect(store().at).toBe(0);
  });

  it("keeps the height it was left at when the reader lets go", () => {
    // The sweep resumes from there rather than from wherever the clock had
    // got to — the difference between a control and an interruption.
    store().hold(0.8);
    store().release();
    expect(store().held).toBe(false);
    expect(store().at).toBeCloseTo(0.8);
  });
});

describe("pinning, so the light stays without a finger on it", () => {
  it("keeps the sweep still when pinned, with nothing held", () => {
    store().togglePin();
    expect(scanIsStill(useScanStore.getState())).toBe(true);
    expect(store().held).toBe(false);
  });

  it("still holds while a finger is on it, unpinned", () => {
    store().hold(0.3);
    expect(scanIsStill(useScanStore.getState())).toBe(true);
  });

  it("travels again once neither is true", () => {
    store().hold(0.3);
    store().release();
    expect(scanIsStill(useScanStore.getState())).toBe(false);
  });

  it("unpins when the scanner is switched off", () => {
    useScanStore.setState({ enabled: true });
    store().togglePin();
    store().toggle();
    expect(store().pinned).toBe(false);
  });
});

describe("sweeping while the assistant answers", () => {
  it("is on unless it was turned off", () => {
    expect(store().sweepOnAnswer).toBe(true);
  });

  it("remembers being turned off, because that was a decision about a machine", () => {
    store().setSweepOnAnswer(false);
    expect(store().sweepOnAnswer).toBe(false);
    expect(localStorage.getItem("anatria3d.scan.sweepOnAnswer.v1")).toBe("off");
  });

  it("writes nothing when the setting has not changed", () => {
    localStorage.clear();
    store().setSweepOnAnswer(true);
    expect(localStorage.getItem("anatria3d.scan.sweepOnAnswer.v1")).toBeNull();
  });
});

describe("the colour of the light", () => {
  it("remembers the choice, because it is a way of reading and not a theme", () => {
    store().setTint("amber");
    expect(store().tint).toBe("amber");
    expect(localStorage.getItem("anatria3d.scan.tint.v1")).toBe("amber");
  });

  it("writes nothing when the colour has not changed", () => {
    localStorage.clear();
    store().setTint("cyan");
    expect(localStorage.getItem("anatria3d.scan.tint.v1")).toBeNull();
  });
});

describe("revealing colour instead of lighting", () => {
  it("is off until it is asked for", () => {
    // The glow is what the mode is recognised by; a reader meeting the scanner
    // for the first time should meet the half that explains itself.
    expect(store().reveal).toBe(false);
  });

  it("remembers being turned on", () => {
    store().setReveal(true);
    expect(store().reveal).toBe(true);
    expect(localStorage.getItem("anatria3d.scan.reveal.v1")).toBe("on");
  });

  it("writes nothing when it has not changed", () => {
    localStorage.clear();
    store().setReveal(false);
    expect(localStorage.getItem("anatria3d.scan.reveal.v1")).toBeNull();
  });
});

describe("the panel that names what is being crossed", () => {
  it("is shown until somebody hides it", () => {
    expect(store().readout).toBe(true);
  });

  it("remembers being hidden, and remembers being brought back", () => {
    // Both directions are written. Remembering only the hiding would mean a
    // reader who wanted it back got it back once, and then lost it again on
    // the next launch with no way to tell why.
    store().toggleReadout();
    expect(store().readout).toBe(false);
    expect(localStorage.getItem("anatria3d.scan.readout.v1")).toBe("off");

    store().toggleReadout();
    expect(store().readout).toBe(true);
    expect(localStorage.getItem("anatria3d.scan.readout.v1")).toBe("on");
  });
});

describe("the scanner's own controls", () => {
  it("are unfolded until somebody folds them", () => {
    expect(store().panel).toBe(true);
  });

  it("remember being folded, in both directions", () => {
    store().togglePanel();
    expect(store().panel).toBe(false);
    expect(localStorage.getItem("anatria3d.scan.panel.v1")).toBe("off");

    store().togglePanel();
    expect(localStorage.getItem("anatria3d.scan.panel.v1")).toBe("on");
  });

  it("folding is not switching the scanner off", () => {
    useScanStore.setState({ enabled: true });
    store().togglePanel();
    expect(store().enabled).toBe(true);
  });
});

describe("fading what the plane has passed", () => {
  it("is off until it is asked for", () => {
    // It changes how the whole body looks; a mode that rearranges the picture
    // the first time somebody presses the switch is one they turn off before
    // they understand it.
    expect(store().ghost).toBe(false);
  });

  it("remembers being turned on", () => {
    store().setGhost(true);
    expect(localStorage.getItem("anatria3d.scan.ghost.v1")).toBe("on");
  });
});
