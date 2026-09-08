# Patient Scan — phase 0

The question this phase existed to answer, and nothing else:

> Attaching `onBeforeCompile` to ~3,478 organ materials — does three compile one
> program, or 3,478?

If it compiled per material, the whole idea was dead: entering the mode would
stall for seconds and no amount of geometry work afterwards would fix it.

**Answer: one shared program. `programs` reads 4 with the band running.**
The premise holds and phase 1 is worth building.

## What was built

Nothing of the mode. No gurney, no supine body, no overhead camera, no state
machine, no AI. Only the band, a temporary `B` key to toggle it, and the
instrumentation to measure the toggle.

- `scanBand.ts` — one module-level `onBeforeCompile`, one module-level uniform
  object shared by reference, and a function that advances the sweep once per
  frame.
- `OrganMesh.tsx` — the material props extracted to a `surface` object so the
  experimental material can reuse them verbatim. When the band is off, no
  `onBeforeCompile` prop is passed at all, so the shipping material is
  bit-identical to `main`.
- `AnatomyScene.tsx` — the `B` key and the per-toggle measurement.

## Why one program and not 3,478

three builds its program cache key from `material.customProgramCacheKey()`,
whose default implementation returns `this.onBeforeCompile.toString()`.

So the sharing depends on one thing: **every material must be handed the same
function**, defined once at module scope. A closure created per mesh would
produce identical source and still work by accident; a closure that captured
anything per-mesh would not. The uniform has to be a shared *object* for the
same reason — one write per frame updates every material, and nothing ever
walks the 3,478.

This is the whole load-bearing detail of the design. If a later change makes
that function per-mesh, the mode stops being affordable and the symptom will be
a multi-second freeze on entry, not a compile error.

## The measurement trap we nearly fell into

`M`'s rolling p95 could not have caught the failure it was there to catch. Its
sampler **discards intervals longer than one second**, so a three-second compile
stall would have been thrown out of the statistic rather than reported as the
worst frame.

The toggle therefore has its own measurement, printed to the console: frame
count and worst frame time across the transition. Anything that measures a rare,
large stall has to be written for that, not inherited from a sampler tuned for
steady state.

## Numbers, band on

Whole male atlas, glass body, 3,478 structures.

```
fps            43
p95            65.4 ms
draw calls   2,346
triangles    8,958,626
meshes       3,478
programs         4
heap           680 MB
```

**Still to be recorded: the same six with the band off, same camera.** Without
it there is no baseline and the band's cost is unknown — the reading above may
be entirely the glass body, which was already the most expensive state the
application ships. Do not quote a cost from this page until that line exists.

## Theories that were wrong, or not yet right

- **"A transparent emissive plane crossing the body is the cheap option."**
  It is one draw call and it is the wrong answer here: a transparent plane
  intersecting thousands of transparent meshes sorts badly and pops. The mode
  requires glass, so this was ruled out before it was written.
- **"The band can stay in world Y."** True while the body stands. Phase 1 lays
  it on a gurney, and world Y stops being the feet-to-head axis. Either the band
  follows the body's own axis or the rotation is applied to the sweep — decide
  this before rotating anything.
- **Two materials live per mesh while the band is on.** The original is kept
  attached-but-unused so its warmed program survives the toggle. That is
  deliberate, and it costs 3,478 extra material objects for as long as the mode
  runs. Heap across off → on → off has not been measured.

## What would still abort this

- `programs` climbing with the atlas size rather than staying at a handful.
- Frames in the mode materially below the glass-body baseline once that
  baseline exists.
- Draw calls, programs or heap not returning to their pre-toggle readings.
- Needing postprocessing to make the sweep look right. There is no
  `EffectComposer` in this project and phase 0 does not introduce one.
