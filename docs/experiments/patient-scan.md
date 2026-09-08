# Patient Scan — phase 0

The question this phase existed to answer, and nothing else:

> Attaching `onBeforeCompile` to ~3,478 organ materials — does three compile one
> program, or 3,478?

If it compiled per material, the whole idea was dead: entering the mode would
stall for seconds and no amount of geometry work afterwards would fix it.

**Answer: one shared program.** Measured against the same view with the band
off, `programs` goes from 2 to 3 — one more for the whole atlas. The premise
holds and phase 1 is worth building.

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

## Numbers

Whole male atlas, 3,478 structures, same camera for both, measured on the
owner's machine 2026-09-07.

| | off | on | change |
|---|---|---|---|
| fps | 48 | 48 | none |
| p95 | 23.1 ms | 23.7 ms | +0.6 ms |
| draw calls | 3,478 | 3,478 | none |
| triangles | 10,944,456 | 10,944,456 | none |
| programs | 2 | 3 | **+1** |
| heap | 529 MB | 575 MB | **+46 MB** |

**On the GPU the band is close to free.** No extra draw call, no extra
triangle, one extra program for the whole atlas, and the frame rate does not
move. That is the shared-uniform design behaving exactly as the theory said it
would, now measured rather than argued.

### The 46 MB, and what it teaches

That is the only real cost, and its source is known: **3,478 duplicate
materials**, about 13 KB each. The original is kept alive but unattached so its
warmed program survives a toggle.

**That trade was made before this measurement existed, and the measurement
retires it.** The duplicate bought one thing — avoiding a recompile on toggle —
and the recompile turns out to be *a single program*, which three keeps in its
own cache keyed by parameters. Phase 1 should drop the duplicate and reclaim
the 46 MB.

One caveat to check rather than assume: three refcounts programs and releases
one when the last material using it is disposed. If React unmounts every old
material before mounting the new ones, the program could be released and
recompiled. Measure the toggle stall after removing the duplicate; do not
assume either way.

### Still unmeasured

Heap after toggling **back off**. If it does not return towards 529 MB, the
materials are not being disposed and that is a leak, not a cost.

## Theories that were wrong, or not yet right

- **"A transparent emissive plane crossing the body is the cheap option."**
  It is one draw call and it is the wrong answer here: a transparent plane
  intersecting thousands of transparent meshes sorts badly and pops. The mode
  requires glass, so this was ruled out before it was written.
- **"The band can stay in world Y."** True while the body stands. Phase 1 lays
  it on a gurney, and world Y stops being the feet-to-head axis. Either the band
  follows the body's own axis or the rotation is applied to the sweep — decide
  this before rotating anything.
- **"Keeping both materials alive is worth it."** It was a reasonable guess
  before the numbers and the numbers retire it: see above. It costs 46 MB to
  avoid a recompile that turns out to be one program.

## What would still abort this

- `programs` climbing with the atlas size rather than staying at a handful.
- Frames materially below the band-off baseline. Measured: they are not — 48
  fps either way, p95 +0.6 ms.
- Draw calls, programs or heap not returning to their pre-toggle readings.
- Needing postprocessing to make the sweep look right. There is no
  `EffectComposer` in this project and phase 0 does not introduce one.
