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
    sound: false,
    sections: 0,
    byAssistant: false,
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

describe("the tone when the light is let go", () => {
  it("is off until it is asked for", () => {
    // Sound is the one thing here that can embarrass somebody: a lecture
    // theatre, a consulting room, a shared office.
    expect(store().sound).toBe(false);
  });

  it("remembers being turned on", () => {
    store().setSound(true);
    expect(localStorage.getItem("anatria3d.scan.sound.v1")).toBe("on");
  });
});

describe("stepping the light", () => {
  it("moves by the fraction it is given", () => {
    store().step(0.1);
    expect(store().at).toBeCloseTo(0.6, 10);
  });

  it("pins it, because stepping means stay here", () => {
    // Otherwise the sweep resumes on the next frame and the section is taken
    // at a height the plane has already left.
    expect(store().pinned).toBe(false);
    store().step(-0.02);
    expect(store().pinned).toBe(true);
  });

  it("stops at the crown and at the soles", () => {
    store().step(5);
    expect(store().at).toBe(1);
    store().step(-5);
    expect(store().at).toBe(0);
  });

  it("does nothing at all when there is nothing to move", () => {
    // `stepFraction` answers zero until the body has been measured, and a
    // no-op must not pin the light as a side effect.
    store().step(0);
    expect(store().at).toBe(0.5);
    expect(store().pinned).toBe(false);
  });

  it("counts sections rather than announcing them", () => {
    store().sectionTaken();
    store().sectionTaken();
    expect(store().sections).toBe(2);
  });
});

describe("being taken to a level", () => {
  it("switches the scanner on rather than quietly doing nothing", () => {
    // A plane nobody can see is not an answer to "show me T8".
    expect(store().enabled).toBe(false);
    store().putAt(0.62);
    expect(store().enabled).toBe(true);
    expect(store().at).toBeCloseTo(0.62, 12);
  });

  it("pins it, so the sweep does not carry it away again", () => {
    store().putAt(0.62);
    expect(store().pinned).toBe(true);
  });

  it("leaves no finger down", () => {
    // `held` describes a hand on the slider. Left set, the control would
    // believe it was being dragged for the rest of the session.
    useScanStore.setState({ held: true });
    store().putAt(0.3);
    expect(store().held).toBe(false);
  });

  it("stops at the ends of the body", () => {
    store().putAt(5);
    expect(store().at).toBe(1);
    store().putAt(-5);
    expect(store().at).toBe(0);
  });
});

describe("whose light it is", () => {
  it("marks the light as the assistant's when it puts it somewhere", () => {
    store().putAt(0.4);
    expect(store().byAssistant).toBe(true);
  });

  it("hands it back the moment the reader moves it", () => {
    // Any deliberate act on the scanner takes it back. A plate still claiming
    // the assistant put the light there would be a small lie on screen.
    for (const act of [
      () => store().hold(0.2),
      () => store().step(0.05),
      () => store().togglePin(),
      () => store().toggle(),
    ]) {
      useScanStore.setState({ byAssistant: true });
      act();
      expect(store().byAssistant).toBe(false);
    }
  });
});
