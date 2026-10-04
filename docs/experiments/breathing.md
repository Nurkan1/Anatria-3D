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
| Vessels in the lung | pulmonary arteries and veins and their lobar and segmental branches | exactly as the lung tissue around them |
| Every other vessel | by where it runs | with the wall by the ribs and above the heart; down with the heart in the middle of the chest |

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

## The vessels

The owner caught it watching a deep breath in a glass body: the intercostal
vessels and the internal thoracic ones stood still while the lung came
forward with the ribs, and the lung swallowed them.

- **Inside the lung**, the pulmonary arteries and veins take the lung's part.
  For that the lungs are now measured **together** (`BREATH_FRAME`), not one
  lobe at a time: a segmental artery's own box says nothing about where it
  lies in the lung. It also stops the lobes moving differently on either side
  of a fissure, so the lungs' own movement changed slightly with it.
- **Everything else is placed by where it runs**, not by its name — the
  vessels along the ribs are partly in meshes named for something else (the
  azygos, the internal thoracic veins). By the wall, it goes with the wall;
  deep in the middle of the chest below the heart's top, down with the heart;
  above the heart, with the wall again, as the thoracic inlet lifts with the
  first ribs. Nothing outside the trunk moves.
- **The blood's light** breathes with the vessel under it.

Measured on the male atlas, from the line the ribs swing about: ascending
aorta, venae cavae and brachiocephalic veins within 3.4 cm; internal thoracic
vessels at a median of 5.3 cm; intercostals at 11. A first guess put the
change between 5 and 10 cm, which left the internal thoracic vessels lagging
the lung by up to 13 mm in a deep breath. Between 3 and 5 cm, with the inlet
following the wall: median 0 mm, the worst tenth 1–2 mm.

## The heart follows the breath

With the heartbeat on as well, the heart rate rises a little as each breath
comes in and falls as it goes out: respiratory sinus arrhythmia, normal and
largest in the young. It is ±5 % at rest and ±11 % in the deep pattern; at
72 a minute that is 64 to 80 in a deep breath, the size the bedside
deep-breathing test looks for in a healthy young adult. It happens however
the heartbeat was switched on, by the reader or by the assistant, and only
while the Breathing switch is on.

- `viewer/sinusArrhythmia.ts` — the timing (`sinusPace`: slowest as a breath
  begins, fastest just after the breath in) and `BreathPacer`, which runs the
  heart's clock faster or slower than real time.
- **Only between beats.** A real heart that speeds up shortens diastole and
  keeps its systole, so the clock runs true through every contraction and
  carries the whole swing in the rest, divided by the share of time the heart
  spends at rest. A test holds S1 to S2 to the same length at every swing.
- **Each rhythm says how much reaches it** (`followsBreath`): the sinus-paced
  ones all of it, sinus tachycardia a third (little vagal tone left to lose),
  and none where something else paces the ventricles — fibrillation, flutter,
  complete block, ventricular tachycardia, arrest. The heartbeat's panel says
  which, of the rhythm on screen.
- **Two clocks.** The rhythm plays on the heart's; everything that must be true
  in real seconds stays on the real one: the flash guard (it counts flashes a
  second), the blood's travel, and the ECG strip's sweep. Swept in the heart's
  seconds, every interval on the strip would come out equal and the
  arrhythmia would be invisible on the trace that should show it, so the strip
  maps real time to the heart's through `ClockTrace`.

Measured in the browser, quiet breathing: the heart's clock ran 0.92–1.08 of
real time and back, in step with the breath.

The assistant is deliberately not given a `set_breathing` tool: it can start
the heartbeat already, and the owner's call is that breathing stays the
reader's switch.

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
- The assistant's picture of the scene does not say the body is breathing, so
  it cannot mention the arrhythmia unprompted when it explains a rhythm.
- A volume trace under the panel, like the heartbeat's ECG strip.
- The lit ghost of an explained structure is a mesh of its own and does not
  breathe.
- The abdominal vessels inside the liver, spleen and kidneys (portal and
  hepatic veins, splenic and renal vessels) do not go down with their organs.
- The alloy body (`experiment/exosuit`) has its own breath. Merging this branch
  into it and giving the alloy material `injectBreath` would make the metal
  body breathe anatomically too.
