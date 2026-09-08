import { beforeEach, describe, expect, it } from "vitest";

import { useScanStore } from "./scanStore";

const store = () => useScanStore.getState();

beforeEach(() => {
  useScanStore.setState({ enabled: false, held: false, at: 0.5 });
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
