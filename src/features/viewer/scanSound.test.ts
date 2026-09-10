import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { forgetScanSound, playScanPing, primeScanSound } from "./scanSound";

const original = (globalThis as { AudioContext?: unknown }).AudioContext;

function stubContext(state: "running" | "suspended") {
  const osc = {
    type: "",
    frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(() => ({ connect: vi.fn() })),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const ctx = {
    state,
    currentTime: 0,
    resume: vi.fn(),
    createOscillator: vi.fn(() => osc),
    createGain: vi.fn(() => ({
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(() => ({ connect: vi.fn() })),
    })),
    destination: {},
  };
  // An ordinary function, not an arrow: the module calls `new AudioContext()`,
  // and returning an object from a constructor is what hands back this stub.
  const Ctor = vi.fn(function fakeContext() {
    return ctx;
  });
  (globalThis as { AudioContext?: unknown }).AudioContext = Ctor;
  return { ctx, osc, Ctor };
}

beforeEach(() => forgetScanSound());

afterEach(() => {
  (globalThis as { AudioContext?: unknown }).AudioContext = original;
  forgetScanSound();
});

it("stays silent on a machine with no audio at all", () => {
  // A Debian box with no sink, a policy that refuses one, an engine that never
  // implemented it. Audio is a nicety; it must not take the scanner with it.
  delete (globalThis as { AudioContext?: unknown }).AudioContext;
  expect(() => primeScanSound()).not.toThrow();
  expect(() => playScanPing()).not.toThrow();
});

it("says nothing until a gesture has started the context", () => {
  // The whole reason priming is a separate call: the pulse fires a frame after
  // the pointer went up, which the browser does not count as a gesture.
  const { ctx } = stubContext("running");
  playScanPing();
  expect(ctx.createOscillator).not.toHaveBeenCalled();
});

it("resumes a suspended context while the gesture is in progress", () => {
  const { ctx } = stubContext("suspended");
  primeScanSound();
  expect(ctx.resume).toHaveBeenCalled();
});

it("plays one tone, and stops the oscillator it started", () => {
  // An oscillator left running is a node nothing collects, and this fires
  // every time a reader lets go.
  const { ctx, osc } = stubContext("running");
  primeScanSound();
  playScanPing();
  expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
  expect(osc.start).toHaveBeenCalled();
  expect(osc.stop).toHaveBeenCalled();
});

it("reuses the one context rather than opening one per ping", () => {
  // Contexts are a handful per page; one per release exhausts them in a
  // minute of ordinary use.
  const { Ctor } = stubContext("running");
  primeScanSound();
  primeScanSound();
  primeScanSound();
  expect(Ctor.mock.calls.length).toBe(1);
});
