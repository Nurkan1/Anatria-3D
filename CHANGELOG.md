# Changelog

What changed in Anatria3D, written for the person using it rather than the
person who wrote it. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file starts at 0.1.7. Earlier releases are described on the
[Releases page](https://github.com/Nurkan1/Anatria-3D/releases) — they are not
reconstructed here, because notes written from memory a year later are a good
way to record something that did not happen.

There is **no auto-updater**, by design: the application never reaches the
network on its own. A new version reaches you only when you download and install
it, so this file is also the answer to "is it worth reinstalling".

## [0.2.0] — 2026-08-20

### Added

**A female atlas.** The atlas now has a second body. A Male/Female switch sits
above the systems list, and choosing Female loads 264 structures built from the
NIH Human Reference Atlas: the vertebral column from C1 to the coccyx, the
pelvic girdle, the uterus with its cervix and walls, both uterine tubes down to
the fimbriae, the ovaries, the vagina, sixteen ligaments and peritoneal folds,
the bladder and ureters, both kidneys, the liver with its impressions and
ligaments, the biliary tract, the pancreas, the spleen, the small and large
intestine, sixty vessels — the pelvic set, the coeliac trunk, the mesenteric
arteries and the whole hepatic portal system — and the breast.

The breast is worth calling out because **the male atlas has none at all**: the
body of the breast, lobes of the mammary gland, lactiferous ducts and sinuses,
suspensory ligaments, nipple, areola and areolar tubercles, on both sides. It is filed
under the integumentary system, where Terminologia Anatomica files it, and it
is the first structure in either atlas to use that system.

The placenta is in the source and is **not** shipped. Terminologia Anatomica is
adult anatomy: it names the umbilical vessels but not the placenta itself, nor
the amnion, the chorionic plate or the cord — those belong to Terminologia
Embryologica, which this atlas does not carry. Three vessels floating where a
placenta should be would teach nothing and look like a failed load.

It is **the trunk, not a whole female body**, and the application says so where
you choose it. There is no skull, no ribcage, no limbs, and no skeletal muscle
or peripheral nerve anywhere — the source models organs rather than a body, and
no open dataset publishes a whole female one.

In one respect it is better than the male atlas, which the structure count
hides. Its viscera are far more finely modelled: a kidney opens into capsule,
hilum, cortex, columns and every pyramid with its papilla, where the male atlas
has a single kidney mesh.

**It is one woman, not an average, and the interface says where she differs.**
The male atlas is an idealised composite; this is a 59-year-old subject. She has
**six lumbar vertebrae** rather than five, and **her kidneys span L1 to L5**
where the classical description is T12 to L3, with the left 2.7 cm longer than
the right. Both are real, both are measurable in the geometry, and neither is
corrected. They are stated where you choose the body, in the guide, and in the
assistant's own instructions — which now give the textbook value first and
describe this body second, so that measuring her on screen does not cost you a
mark in an exam.

Every structure carries its Terminologia Anatomica Latin, matched by hand,
because the source names anatomy with UBERON and FMA labels that are not unique
and often word structures differently. Eleven structures in the source are not
shipped, because TA2 does not list them and inventing Latin would be worse than
leaving them out; three more that TA2 does name are left out by judgement, and
they are recorded separately so a decision cannot hide behind the standard.

The two atlases stay in separate files under their own licences — the male one
share-alike through Z-Anatomy, the female attribution-only through the HRA —
and nothing merges them. **An exported image now credits whichever atlas it came
from**, read from that atlas's own manifest, so a plate of the female pelvis
carries the NIH Human Reference Atlas and CC BY 4.0 rather than a line about
Z-Anatomy.

**Structures now say which one they are.** A labelled spine used to export with
twelve identical *Vertebra thoracica* on twelve leader lines, and both halves of
a hip bone as *Os ilium*. Where Terminologia Anatomica names a structure
individually its own term is used — every vertebra is numbered there, so T7 is
*Vertebra thoracis VII*, exactly as the male atlas already called it. Where TA2
names only the class, the part is appended after it: *Os ilium · left · compact
bone*.

**The assistant can now isolate a whole organ.** Ask it for "the kidney" or "the
spine" and it shows you all of it. That sounds like something it could always
do, and it could not: most of what a reader asks for is a heading in the atlas
rather than a structure with an identifier — the kidney is fifty separate meshes
on the female body, the muscles are four hundred on the male, and 109 of the
male atlas's 110 groups have no mesh of their own. You could isolate them by
right-clicking; the assistant had to name every part or admit it could not.
It now reaches the same groups you do, through the same resolver, so the two
cannot drift into isolating different anatomy under one name.

The sixth lumbar vertebra is the one place the two atlases cannot agree, and it
is the more useful for it. TA2 stops at L5 — it does not name a sixth, because
it does not expect one — so that vertebra alone reads *Vertebra lumbalis · L6*
under *Vertebra lumborum V*. The variant announces itself in the label.

**The assistant answers better when you point first, and now it says so.** Select
a structure before you ask and the assistant is told exactly what you mean and
treats it as the subject; select several and it is told to compare them. With
nothing selected it is handed a summary of every structure loaded and has to
search the atlas before it can start — a vaguer answer, and a larger bill,
because every search is another pass through the whole conversation.

A **How to ask** button sits under the composer with the four things worth
knowing. And if you start typing a question with nothing selected, one line says
so. It appears while you type rather than sitting there as a banner, and it
retires itself the first time you ask with something selected — which is the
behaviour it was asking for, so nobody who already works this way is ever told
to. It stays out of case drills entirely: there the subject is the patient, and
what you are typing is an answer.

**Printed pages now say when a model wrote part of them.** A PDF containing
assistant answers, or a case the assistant graded, carries a notice at the foot
of every page — beneath the medical one, which still reads first.

It appears **only when something on the page was actually generated**. A notebook
of your own notes carries nothing, because there is nothing to disclose.

The notice also says where its knowledge stops: notes are entered by you, and
Anatria3D does not record where their text came from. That second half is not
padding. Without it the first half would quietly certify that everything
unmarked was written by a human, and that is not something this application can
know — a paragraph pasted from a chatbot and one copied from a textbook arrive
through the same keystroke. Anatria3D does not guess: it does not run your
writing through a detector, and it does not record what you paste. Both would
produce false accusations, and detectors are wrong most often about people
writing outside their first language.

**The application now says which version it is.** `v0.2.0` sits in the tab strip
above the atlas, in the guide's footer, and on every plate you export. There is
no auto-updater here by design, so the copy on your machine is whichever one you
last installed — and until now nothing on screen said which that was. That
mattered in three places: reporting a problem meant guessing, an exported plate
carried no record of the build that drew it, and two plates of the same
structure could disagree with nothing to say which was current. The corrections
below are exactly that kind of change.

### Fixed

**Asking for the brain gave you half a brain.** Isolating `Brain` returned 68
structures: the right hemisphere's gyri and sulci, and the cerebellum. The left
hemisphere, the entire brainstem, the entire diencephalon and the corpus
callosum were filed as *siblings* of the brain rather than parts of it, so they
were hidden. Ask the assistant how many parts the brain has and it would explain
correctly while showing you a model missing most of what it was naming — and the
numbered pins in its answer pointed at structures that were not on screen.

It was a fault in the hierarchy the atlas inherits, not in the anatomy or the
rendering. For the application, the left precentral gyrus was not part of the
brain. 195 structures are refiled, and `Brain` now holds 200: both hemispheres,
the diencephalon, the brainstem with its midbrain, pons and medulla, and the
cerebellum. The meninges and the spinal cord are deliberately *outside* it —
isolating the brain should not bring the dura with it.

Nine groups you can now isolate by name did not exist before: **Brainstem,
Diencephalon, Mesencephalon, Pons, Medulla oblongata, Ventricular system, Spinal
cord, Meninges** and **Eyeball**. Ask for the brainstem and you get the
brainstem.

Nothing outside the nervous system moved, and no structure was added, removed or
renamed.

**The female atlas opened as a bare pelvis.** Switching to it showed the
skeleton alone, and the uterus, kidneys, gut, vessels and breast each had to be
switched back on by hand — every time you switched. It now opens whole.

The male atlas still opens on the skeleton and loads the rest when you ask for
it, because it is 37 MB across thirteen files. The female module is 5.3 MB
across seven; the six systems that used to wait come to 4 MB between them, read
off local disk. The saving was never worth what it cost to use.

**White scrollbars in a dark interface.** On a machine with Windows set to light
mode, every scrollbar rendered light — white tracks with stepper arrows, down the
side of the atlas tree and the transcript. The application had told the browser
it followed the system theme, and it does not: the panels are dark whatever
Windows is set to, and the Dark/Light control changes the background *behind the
model*, not the interface around it. Scrollbars are now dark, narrow, and
without the arrow buttons, so several scrolling panes sit together without any
of them looking like a document.

**Pointing at something now shows it.** When the assistant lit a structure that
an isolation was hiding, the light fell on nothing and the pin beside it led
nowhere. Lighting a structure now brings it into view — it widens what you are
shown, never narrows it.

**And everything it names is lit, not just the first few.** The light's
brightness was graded by the same falloff the cursor uses to show depth, which
goes fully dark past the sixth layer. The assistant may name up to
twenty-four structures — so from the seventh onwards nothing lit at all, while
the answer still carried a numbered pin pointing at it, and the fifth or sixth
arrived so dim that a deep structure behind a ghosted brain was indistinguishable
from unlit. The order still reads — the first structure named is brightest — but
the last one named is now unmistakably lit rather than nearly invisible.

**Sixty-one Latin terms were misspelled, truncated or named the wrong
structure.** An audit of every label in both atlases against Terminologia
Anatomica found defects in the vendored term list that reached the screen and
the printed plates. They fall into four kinds, and the fourth is the one that
mattered:

- **Accents that do not belong in Latin.** Fifty rows had picked up the French
  spelling from the column beside them — `Nodi sacrales latérales` for *Nodi
  sacrales laterales*. Latin anatomical terms carry no diacritics, so this is
  now fixed by rule rather than row by row.
- **A word left stuck on the end**, usually the row's synonym run into the main
  term with no separator: `Regio retromalleolaris lateralis regio`, `Arteria
  transversa colli arteria transversa cervicis`.
- **Letters dropped or misread** — `Arteria musculoohrenica` for
  *musculophrenica*, `Venae pudendales extemae` for *externae*.
- **Terms that had lost the word identifying them**, which is worse than a
  misspelling because what remains is a real name for something else.
  `Arteria pancreaticoduodenalis` without *inferior* is a different vessel;
  `Radix anterior nervi cutanei femoris` without *posterioris* is a different
  nerve. Worst of the set, the articular capsules of the **metatarsophalangeal**
  joints carried the **glenohumeral** capsule's Latin — a label in the foot
  naming a joint in the shoulder.

114 structures in the male atlas and 2 in the female now read differently. No
structure was added, removed or renumbered, so nothing you had saved refers to
anything else. Both renal arteries now read `Arteria renalis`, which is the term
Terminologia Anatomica publishes; the side is on the English name, where it
already was.

The atlas now refuses to build if any Latin label carries a diacritic or repeats
a word — the two signatures every one of these defects left behind.

## [0.1.7] — 2026-08-16

### Added

**Virtual patients you can follow across visits.** A case file is no longer a
single question and an answer. Each visit adds to the record — a weight that
came down, a pressure that did not, what the imaging said — and the assistant
reasons from the record as it stands at that visit. The order is the clinical
content: a figure that moved over four visits is a different case from one that
was always there.

The answer is written when the case is opened, before anything is attempted, and
cannot be edited afterwards. That is the whole discipline — an answer decided
once the attempt is in hand grades nothing. It can now be opened deliberately,
with a confirmation in front of it, and a case that has been opened stays open,
so a summary cannot include the answer today and withhold it tomorrow.

**A resting screen.** After fifteen minutes, or on `Ctrl+X`, the body fades to a
grey brain lit by slow waves of neon blue expanding from points on the cortex.
It is capped to a low frame rate and stops entirely when the window is hidden,
so it costs a laptop almost nothing.

**A keyboard for the viewport.** `I` isolate, `H` hide, `U` bring back what is
hidden, `C` clear the selection, `X` step the exploded view, `F` fit, `A P L R S`
for the anatomical viewpoints, and `+` / `−` to zoom. The letters match what is
printed on the buttons, and a single place decides whether a keystroke belongs to
the viewport — so typing "aorta" into a search box no longer turns the body.

**More from the list of what is under the cursor.** The panel naming everything
a ray from your pointer crosses can now be switched off from the left panel or
the right-click menu, pinned by clicking the body so you can walk over to it,
isolated whole — a ray through the shoulder is a surgical approach written down —
or picked from: `Ctrl`-click the lines to take three of the twelve and leave the
rest of the body out of the way. Picked lines join the same selection a
`Ctrl`-click on the body builds, so `I` isolates them.

**Writing boxes that grow with what is in them.** Every field that takes prose —
the chat, notes, the patient record, the case composer — now fits what you paste
into it, up to a limit, and scrolls after that. Reviewing a pasted case no longer
means reading it three lines at a time.

**A journal that folds.** Notes, patients and sessions each fold away, with the
count kept beside the heading. Notes rest folded, because notes are what you go
and look up while the patients and sessions are the work in front of you. A
search opens all three, since one box narrows all three.

### Fixed

**Installers shipped a stale engine.** `tauri build` never re-froze the Python
sidecar, so a build could carry an engine hours older than the interface it was
bundled with — including prompt changes, which are the easiest to miss because
they are "just words". Freezing the sidecar is now part of the release build.

**Notes could not be written in a new conversation.** A note carries the
conversation it was written in, but a conversation only reaches the journal once
a turn has been filed — so writing a note before the first answer failed with a
foreign key error every time, while saving a note from an answer worked. If you
have wondered why your note count stayed at zero, this is why.

**The open patient record ran off the window.** Nothing bounded its height, so a
long record pushed the conversation to nothing and then carried on past the
bottom of the screen, with the end of the sealed answer somewhere no scrollbar
could reach. It now takes at most half the panel and scrolls itself.

**A click that ended an orbit selected whatever it landed on.** Rotating the body
and releasing the mouse picked a structure. A drag is now a drag.

**A single click did nothing with the body in glass.** With everything ghosted
there was no structure solid enough to accept the click, so selection silently
stopped working while double-click went on isolating.

**The tree opened with every system expanded**, which meant reaching for
*Collapse all* before doing anything.

**The cursor list stayed behind after the pointer left**, describing a place
nobody was pointing at.

**Export and Import claimed a count of zero** beside them, which read as a
failure when nothing had failed.

### Changed

The release pipeline builds and publishes nothing when run by hand, attaching the
packages to the run instead — so a build can be installed and tried on a real
machine before a tag claims it works there. And the five files that carry the
version are checked against each other, and against the tag, before anything is
built.
