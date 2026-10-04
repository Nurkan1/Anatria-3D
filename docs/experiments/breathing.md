# Experiment: breathing

Branch `experiment/breathing`, from `main`. Local. A "Breathing" switch beside
"Heartbeat" makes the body breathe in the ordinary view, at rest or deeply,
with a panel that says which half of the breath it is and what is doing it.

Unlike the alloy body this one is meant to teach, and it is a candidate for
release. It is **not in the guide yet**: an experiment's controls must not be
described there until the branch is merged (see AGENTS.md §8).

## What moves, and why

Each structure is given a part by what the atlas calls it (`breathRole`), and
the shader moves it by where it is:

| Part | Structures | Movement at rest |
|---|---|---|
| Diaphragm | the diaphragm and its fascia; not its attachment markings | the dome's top descends 1.5 cm, its rim on the ribs stays |
| Lung | lobes, bronchi inside them, pleura; not the trachea | carried by the ribs beside it, and lengthened down 1.1 cm at the base, over the dome only |
| Chest wall | ribs, costal cartilages, sternum, rib joints, intercostals, pectorals, serratus, the chest's skin | up 3 mm and forward 5 mm, most at the front, nothing at the arms |
| Viscera | liver, stomach, spleen, pancreas, gallbladder, duodenum, kidneys, adrenals; not lymph nodes | down 1.2 cm |
| Belly | rectus abdominis, obliques, transversus, the abdomen's skin | forward 7 mm around the navel |
| Heart | the chambers the heartbeat recognises | down 5 mm, riding the diaphragm |

Deep breathing is three times these, at 6 a minute instead of 12, and in
faster than out in both. Switched on it fades in over a second; switched off,
the breath is allowed to finish going out before it stops.

The panel says *illustrative* on its face, as the heartbeat's does: the right
parts move the right way by about the right amount, and that is all that is
claimed. It is not a mechanical simulation.

## How it is built

- `viewer/breathing.ts` — the roles, the patterns, the timing, and
  `injectBreath`, which adds the movement to a vertex shader **after** three's
  projection. That is what lets it compose with the heartbeat, which moves the
  chambers before projection, and with everything downstream (clipping).
- Every material a structure draws with breathes: the plain one carries
  `breathOnBeforeCompile`, and the scanner's and the heartbeat's hooks call
  `injectBreath` at their end. Switching the scanner or the heartbeat on does
  not stop the chest.
- `viewer/BreathDriver.tsx` — one write a frame to a shared uniform, nothing
  while off. `viewer/BreathControls.tsx`, `stores/breathStore.ts`.
- One shared function and shared uniforms, `scanBand.ts`'s rule: one program,
  and with the switch off a single uniform test skips everything.

The geometry the pointer is tested against does not move. At a centimetre or
two that is under what a pointer can tell; at deep breathing's 4.5 cm on the
diaphragm it may be noticed when clicking the dome mid-breath.

## What was wrong on the way

- **The lungs came out through the ribs.** First they had a sideways travel of
  their own (4 mm, 12 mm deep) on top of the ribs'. Then, with the ribs'
  movement, their whole base still slid down the inside of a cage that narrows.
  Now they move sideways exactly as the chest wall beside them, and only the
  middle of the base — over the dome — descends. The owner confirmed it on
  screen.
- **A measurement that measured nothing.** Reading `BREATH_FILL` from the page
  after a hot reload imported a *new* copy of the module — Vite serves the
  reloaded one under a different URL — so the value read 0 while the body
  breathed. Read state from the running app, not from a fresh import, or
  reload the page first.

## Not done, and worth doing

- The guide's paragraph, before any merge.
- The assistant cannot switch it on: a `set_breathing` tool, like
  `set_heart_rhythm`, would let it show "what the diaphragm does" as it says it.
- **Respiratory sinus arrhythmia**: with both on, the heart rate could rise a
  little on each breath in and fall on each breath out — a real, normal and
  much-examined effect that nothing else in the atlas can show.
- A volume trace under the panel, like the heartbeat's ECG strip.
- The blood's light (`bloodFlow.ts`) and the lit ghost of an explained
  structure are meshes of their own and do not breathe; on the heart's
  chambers the light can lag the wall by its 5 mm.
- The alloy body (`experiment/exosuit`) has its own breath. Merging this branch
  into it and giving the alloy material `injectBreath` would make the metal
  body breathe anatomically too.
