import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EcgStrip, SWEEP_S, sweepColumn, traceRow } from "./EcgStrip";

describe("EcgStrip", () => {
  it("sweeps across the strip and wraps at the end of each sweep", () => {
    expect(sweepColumn(0, 200)).toBe(0);
    expect(sweepColumn(SWEEP_S / 2, 200)).toBe(100);
    expect(sweepColumn(SWEEP_S + 1, 200)).toBe(sweepColumn(1, 200));
  });

  it("keeps a tall wave inside the strip", () => {
    expect(traceRow(50)).toBeGreaterThanOrEqual(1);
    expect(traceRow(-50)).toBeLessThan(40);
    // Up is positive, as on paper.
    expect(traceRow(1)).toBeLessThan(traceRow(0));
  });

  it("says what it is, where the reader can see it", () => {
    render(<EcgStrip />);
    expect(screen.getByRole("img", { name: /schematic ecg/i })).toBeTruthy();
    expect(screen.getByText(/not a recording/i)).toBeTruthy();
  });
});
