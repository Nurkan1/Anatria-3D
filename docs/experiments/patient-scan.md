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

### After toggling back off: no leak

Measured: the reading fluctuates between **493 and 570 MB**.

The floor matters and the ceiling does not. `heapMb` reads
`performance.memory.usedJSHeapSize`, which is the garbage-collected JS heap —
it sawtooths continuously and reports what is allocated and not yet collected,
not what is retained. A 570 MB peak is a heap that has not collected recently.

**A floor of 493 MB is below the 529 MB the session started at, and leaked
materials cannot make a heap fall below where it began.** The memory comes
back.

One observation is not a proof, and the rigorous version is cheap: toggle five
times and watch *only the floor*. A stable floor near 490 confirms it; a floor
climbing 490 → 540 → 590 is a ratchet and a real leak. A wide sawtooth says
nothing either way.

### The instrument is missing a counter

We are squinting at a garbage-collected number because **the panel cannot count
materials**. `renderer.info.memory` exposes geometries and textures only, and
materials are precisely what this design duplicates.

`RenderStats` already walks the scene twice a second for its other figures.
Adding a material count to that sweep is cheap and turns this question from an
inference into a measurement — worth doing before phase 1 removes the
duplicate, so the removal can be verified rather than believed.

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
- A heap *floor* that ratchets upward across repeated toggles. The peak is
  meaningless; only the floor is evidence.
- Needing postprocessing to make the sweep look right. There is no
  `EffectComposer` in this project and phase 0 does not introduce one.

---

# Phases 1 and 2

Built after phase 0 proved the shared program. Both work; the owner has driven
them on the real atlas.

**The ring, not a gurney.** The staging was going to be a body laid on a table
and the owner replaced it with a ring around a standing body. It is the better
idea for a reason that is not aesthetic: laying the body down means either
rotating the scene root — which moves the ground under picking, labels,
clipping planes, `orientView` and every bounds calculation that assumes up is
+Y — or faking it with the camera, which collapses the moment the reader
orbits, and orbiting is a requirement. A ring has neither problem and reads
correctly from every angle.

**The sweep axis is a parameter.** It began as world Y, which is feet-to-head
only while the body stands. It is now a unit vector named at the call site,
with `scanRangeAlong` to project a box onto it, and three tests that fail if
anyone reintroduces the assumption. The decision lives in a signature rather
than in a brief, which is the only way it survives a refactor.

**The whole structure lights, not just the slice.** Each material carries its
own span through `userData`, read by the shared `onBeforeCompile` — three calls
it as a method, so `this` is the material. One function still serves all 3,478,
because uniform *values* play no part in the cache key.

**And it says what it found.** Six structures named, biggest first, with the
rest counted. Volume is the honest order: a plane through the thorax crosses
two hundred structures and the big ones are what somebody is learning.

## What was wrong along the way

Kept because each one looked like something else.

- **"A cylinder makes a good light shaft."** It reads as a box. A cylinder seen
  near edge-on *is* a rectangle, and its silhouette ends abruptly at the sides —
  which is exactly where an additive surface is brightest, because that is
  where the view grazes it. Bright light stopping at a straight edge is the one
  thing light never does. A flattened sphere has no hard silhouette from any
  angle; no falloff curve would have saved the cylinder.
- **"The white speckles are a texture problem."** They were z-fighting. Two
  concentric rings shared the span `[r-t, r-0.65t]` and fought over the depth
  test. Concentric geometry that shares space always will; the radii are now
  disjoint by construction.
- **"Light can be a constant."** It cannot. A real beam varies as it travels,
  and an unchanging additive surface is what an eye reads as painted on. The
  intensity now breathes, phased on *where the sweep is* rather than on the
  clock alone — tied to time it pulses like a decoration, tied to travel the
  variation belongs to the movement.
- **"Twelve seconds is a good sweep."** Too quick to read: a structure lit and
  went dark before the eye found its name below, which defeats the point of
  naming it. Twenty. And three tests failed on that change and were right to —
  they were written in seconds rather than in fractions of a cycle. The
  duration is exported now and they say the invariant instead.
- **"The panel can toggle its own visibility imperatively."** Twice: first the
  `hidden` attribute, then `style.display`. Both tell React one thing and write
  another to an element React renders and therefore owns, which is a race
  nobody can watch losing. It hid the panel behind what looked like a logic bug
  for two rounds. Visibility is state; only the words are imperative.
- **"A cache on the readout text is free."** It cost the feature. On the first
  pass the panel is not mounted, so the guarded write was skipped while the
  cache was updated anyway; from then on the ids always matched and the text
  was never written. It saved two `textContent` assignments a frame.

## One that should worry a reader more than the rest

A **NUL byte** reached the source through an editing script of mine —
`organIds.join("\0")` where a space belonged. It compiled, it typechecked and
it passed 958 tests, because that separator only fed the equality check that
has since been deleted.

Nothing in the toolchain objects to a NUL in a string literal. What surfaced it
was an exact-match edit refusing to touch the block. Worth knowing before
trusting a scripted edit over a diff read by eye.

## Where it stands

Still a proof of concept behind a scaffolding `B` key, deliberately not
documented in the guide. No entry animation, no camera work, no mode. `main` is
untouched and this branch has never been pushed.
