# Anatria3D

[![Gates](https://github.com/Nurkan1/Anatria-3D/actions/workflows/gates.yml/badge.svg)](https://github.com/Nurkan1/Anatria-3D/actions/workflows/gates.yml)
[![License](https://img.shields.io/badge/code-Apache--2.0-blue)](LICENSE)
[![Male atlas](https://img.shields.io/badge/male%20atlas-CC%20BY--SA%204.0-blue)](public/anatomy/NOTICE)
[![Female atlas](https://img.shields.io/badge/female%20atlas-CC%20BY%204.0-blue)](public/anatomy/NOTICE)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21921085.svg)](https://doi.org/10.5281/zenodo.21921085)

Interactive anatomy and AI insights — a local-first desktop application.

An educational anatomy atlas whose AI assistant can drive the 3D viewport
directly: ask it to show the left ventricle with hypertrophy and the scene
responds, because the agent's tools are typed and validated against the meshes
actually loaded.

> **Not a medical device.** Anatria3D is for anatomical education and study. It
> does not diagnose, treat, or give advice about any individual. See
> [Regulatory positioning](#regulatory-positioning).

---

![The atlas with the body surface ghosted, showing the brain and the cerebral
vessels, while the assistant explains why a smell recalls a memory. Numbered
pins in the answer link each named structure to the model.](docs/screenshots/atlas-and-tutor.png)

**Ask, and the model answers with you.** The assistant moves the camera, ghosts
the layers in the way and marks what it is naming, so the explanation and the
thing being explained are on screen together. Every structure it names carries a
numbered pin: hover to highlight it, click to fly there.

![The heart isolated with sixty-two vessels folded in, every structure labelled
in Terminologia Anatomica Latin with leader lines into the
margins.](docs/screenshots/heart-with-its-vessels.png)

**An organ is studied with its supply, or it is not studied.** The atlas files
structures by system, so isolating the heart leaves the coronary arteries behind
under *Systemic arteries*. One button folds in every vessel that reaches what
you are studying — here, sixty-two of them — and the labelled view turns it into
a plate you can print.

![The revision coverage map: the body coloured by the reader's own notes and
sessions, with a legend reading not yet, been here,
most.](docs/screenshots/revision-coverage.png)

**And it knows what you have already studied.** Notes and sessions are filed
locally against the structures they were about, so the atlas can be coloured by
your own revision. Forty notes on the thorax and nothing on the pelvis is
invisible in a list, and impossible to miss as a shape on a body.

---

## Download

**[Latest release](https://github.com/Nurkan1/Anatria-3D/releases/latest)** —
Windows and Linux, 64-bit. Four files, for four situations:

| File | Take this one if |
|---|---|
| `Anatria3D_<version>_x64-setup.exe` | Windows, on your own machine. |
| `Anatria3D_<version>_x64_en-US.msi` | Windows, deploying across a faculty or a lab through Group Policy or Intune. |
| `Anatria3D_<version>_amd64.deb` | Debian, Ubuntu, Mint, Kali. Installs to your applications menu. |
| `Anatria3D_<version>_amd64.AppImage` | Any Linux. No installation and no root — `chmod +x` and run it. |

The Linux packages are built on Ubuntu 22.04 deliberately, so they also run on
newer distributions.

**Windows installs without administrator rights.** On a university laptop where
you are not an administrator, you can still install it.

**No account, no key and no internet are needed to start.** All 3,742
structures — 3,478 in the male atlas, 264 in the female trunk — the
labelling, cross-sections, exploded views and image export work offline the
moment you install. Only the AI tutor needs an API key of your own —
which also means your questions go straight to your provider, never through a
server of ours.

> **Windows will warn you the first time.** Anatria3D is not code-signed — a
> certificate costs money the project does not spend — so you will see *"Windows
> protected your PC"*. Click **More info**, then **Run anyway**.
>
> If you would rather check before trusting it, every release lists the SHA-256
> of each file. Compare with `certutil -hashfile <file> SHA256`. The source for
> that exact build is the tag it was cut from, and you can build it yourself.

There is **no auto-updater**, on purpose: the application never reaches the
network by itself. New versions appear on the releases page, and nowhere else —
Anatria3D is not distributed by email or on request. Because reinstalling is
something you have to decide to do, [CHANGELOG.md](CHANGELOG.md) says what is
different in each one.

Every installer is built by
[GitHub Actions](https://github.com/Nurkan1/Anatria-3D/actions/workflows/release.yml)
from the tag it is named after, so the path from this source to that file is
public and checkable. Releases are cut following [RELEASING.md](RELEASING.md).

---

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Tauri shell, IPC chain, OS-keyring credentials, Python sidecar | **Done** |
| 2 | 3D engine, Z-Anatomy asset pipeline, scene store | **Done** |
| 3 | Pydantic AI agent, scene-control tools, compliance guardrails | **Done** |
| 4 | Chat panel, model discovery, text↔model references, resizable shell | **Done** |
| 5 | Study journal, printing, exploded view, depth probe, revision map | **Done** |

Every panel is a production component and the quality gates are green across
TypeScript, Rust and Python.

**The interface is English only, by decision rather than omission.** Translating
the chrome would leave the anatomy untranslated beside it, which is the harder
half and the one that must not be a frozen lookup table — rendering a structure
for a layperson, a student and a clinician needs three different explanations per
language. That is the assistant's job, done per turn with the reader's profile in
hand, and it already answers in the reader's own language even when the
interface does not offer it.

Open: the female head, thorax and limbs, and female musculature anywhere, which
need a source that does not exist in the open — see
[There are two atlases, and the female one is a trunk](#there-are-two-atlases-and-the-female-one-is-a-trunk).

---

## Requirements

| Tool | Version | Notes |
|---|---|---|
| Node | 24+ | |
| pnpm | 9+ | |
| Python | 3.12+ | |
| Rust | 1.82+ | plus the platform toolchain Tauri v2 needs |

## Setup

```bash
pnpm install
python -m venv .venv
.venv/Scripts/python -m pip install -e "engine[dev]"   # POSIX: .venv/bin/python
```

## Development

The Rust process launches the frozen Python engine, so **the engine must be
built before the app will start**:

```bash
pnpm sidecar:build     # freezes engine/ -> engine/dist/anatria-engine/
pnpm tauri dev
```

Rebuild the sidecar after changing anything under `engine/`. Frontend changes
hot-reload as usual; only Python needs the re-freeze. Note that `pnpm tauri
build` does **not** do it for you — `beforeBuildCommand` is only `tsc` and Vite,
so a forgotten re-freeze pairs a new window with whatever engine was last
frozen. The app says so in the assistant panel when a frame arrives that it
cannot read, which is what that mismatch looks like from the inside.

**Test the frozen build, not just the interpreter.** Two failure modes only
appear after PyInstaller: distributions that read their own version through
`importlib.metadata` need `--copy-metadata` or raise `PackageNotFoundError`
from deep inside pydantic-ai's imports, and symbols re-exported through a module
`__getattr__` resolve under a normal interpreter but not in the bundle.

## Checks

```bash
pnpm typecheck                                    # TypeScript
pnpm test                                         # includes the IPC contract test

cd engine && .venv/Scripts/python -m pytest -q    # POSIX: .venv/bin/python
cd engine && .venv/Scripts/python -m ruff check .

cd src-tauri && cargo test
cd src-tauri && cargo clippy --all-targets -- -D warnings
```

`tests/protocol-contract.test.ts` spawns the project virtualenv to compare the
Zod and Pydantic definitions of the wire format. It needs the venv to exist.

---

## Architecture

```
React (webview)          Rust (native)              Python (sidecar)
─────────────────        ──────────────             ─────────────────
invoke('ask_agent')  ──► reads key from OS      ──► Pydantic AI agent
  (no api_key)           keyring, writes             tools validated against
                         NDJSON to stdin             the loaded manifest
                                                          │
sceneStore  ◄── emit ◄── reads stdout lines  ◄──── NDJSON events
  │                                                 (text deltas +
  └─► R3F scene reacts                               scene commands)
```

Three properties this buys, each deliberate:

**The API key never enters JavaScript.** Rust reads it from the OS credential
store and injects it into the sidecar's stdin. No Tauri command returns a key —
the webview can store one and ask whether one exists, nothing more.

**Engine state is asked for, not awaited.** `ready` is emitted once, and Rust
spawns the sidecar in `setup()` — before the window has run a line of
JavaScript. A frontend that only listens is betting on winning that race, and
losing it leaves the composer disabled with no way back. `EngineHandle`
therefore remembers both the readiness and the reason it is absent, and
`engine_status` answers whatever already happened; the event carries whatever
happens next. A failed spawn is the sharper case — reported from `setup()`, it
is *always* lost, so a missing engine binary would otherwise read as an
unexplained "offline".

**No network surface.** The engine speaks NDJSON over stdio rather than serving
HTTP on localhost, which any other process on the machine could reach. This
process holds the user's API keys; it has no port.

**The AI cannot invent anatomy.** Every scene-control tool validates its
`organ_id` against the manifest actually loaded, and raises `ModelRetry` on a
miss. A hallucinated identifier never reaches the viewport.

The app ships with **no shell permission at all** — the engine is spawned from
Rust with `std::process::Command`, so the webview has no path to executing
anything. See [`src-tauri/src/sidecar.rs`](src-tauri/src/sidecar.rs) for why
that is also what makes PyInstaller `--onedir` workable.

Found a hole in any of that? [`SECURITY.md`](SECURITY.md) says where to send it
— privately, not as a public issue.

### Layout

```
src/            React 19 + TypeScript + Tailwind v4
  lib/schemas.ts    Zod wire format — one of two protocol owners
src-tauri/      Rust: process ownership, credentials, event forwarding
  src/study_db.rs   SQLite study journal — notes, sessions, case grades
engine/         Python: NDJSON transport, agent, report compiler
  anatria_engine/protocol.py   Pydantic wire format — the other owner
public/anatomy/ Meshes and labels (CC BY-SA 4.0 — see NOTICE)
tests/          Cross-language contract test
```

### Protocol ownership

The wire format is defined twice — Zod in `src/lib/schemas.ts` and Pydantic in
`engine/anatria_engine/protocol.py` — and nothing in either type system connects
them. `tests/protocol-contract.test.ts` is that connection: it derives a
normalised surface from each and asserts they match. **Change one side, run the
tests.** Rust deliberately models only the two fields it needs (`provider`,
`request_id`) so the protocol has two owners, not three.

---

## How the assistant drives the viewport

Asking "how does the heart pump blood?" produces a guided tour, not a wall of
text. The agent calls `focus_organ` on each structure as it reaches it, and the
camera moves **while** the explanation is still streaming.

That interleaving is structural, not a timing trick. A tool writes its scene
command to stdout the instant the model calls it, inside the tool body — the
commands are not collected and flushed at the end of the turn. Text deltas ride
the same stream, so the two interleave naturally on the way to the viewport.

### The tools

| Tool | Effect |
|---|---|
| `focus_organ` | Move the camera to a structure and select it |
| `isolate_structures` | Show only these, hide the rest |
| `show_all_structures` | Clear isolation and section |
| `set_layer_visibility` | Switch a whole system on or off |
| `apply_pathology_overlay` | Tint a structure by severity (0–1) |
| `clear_pathology_overlays` | Remove every overlay |
| `set_cross_section` | Cut the model on a plane to reveal the inside |

The chat panel carries conversation history across turns, so a follow-up like
"and why?" reaches the model with the thread attached. Only *completed*
non-empty turns are replayed — feeding back a failed or half-streamed answer
would teach the model that broken turns are normal. Tool calls from earlier
turns are not replayed either: the viewport has moved on, and stale scene
context invites reasoning about a scene the user is no longer looking at.

**Every tool validates against the structures actually loaded** and raises
`ModelRetry` on a miss, naming close matches. A hallucinated `organ_id` never
becomes a scene command — it is turned back at the tool boundary and the model
tries again with the real inventory in hand. `test_scene_tools.py` asserts this
directly; it is the property the whole design exists to guarantee.

### Linking the answer to the model

Where the assistant names a loaded structure it appends `[[organ_id]]`. The
panel turns each marker into a numbered pin: hovering highlights that mesh,
clicking flies the camera to it, and a legend under the answer lists every
structure it pointed at. A long explanation stays anchored to what is on screen
instead of asking the reader to find it themselves.

Markers resolve against the structures actually loaded. Nothing validates ids
the model merely *writes in prose* — only the ones it passes to tools — so an
invented id is stripped rather than left as literal brackets mid-sentence. Copy
strips the markers too, along with the space in front of them, so pasted text is
clean.

Pins write to the same `sceneStore` the assistant's tools do, so clicking a pin
and the model calling `focus_organ` leave the viewport in identical states.

### Choosing a model

The settings drawer lists the models a stored key can actually reach, fetched
from the provider. That call is also the key check: the request that fills the
picker is the one that proves the credential works, so there is no separate
"test key" button that could pass while real questions fail.

This matters in practice because a busy model answers HTTP 503, which is not a
broken key and not our bug. `service_unavailable` is its own error code for
exactly that reason — the user's move is to retry or pick another model, and
"internal error" would leave them with neither. Defaults avoid preview models
for the same reason: those are the ones that saturate.

### Instruction layers

Composed in this order every turn, safety first so nothing later can argue past
it:

1. **Safety** — the MDR boundary. Not tunable, asserted by `test_prompts.py`
   across all nine profile × language combinations.
2. **Scene** — the assistant is expected to show, not only tell.
3. **Case** — only in drill mode: present a scenario, withhold the answer, then
   grade the attempt. Composed *below* safety, never in place of it.
4. **Profile** — depth and register for layperson / student / clinician.
5. **Language** — the output language, plus how to render Latin nomenclature
   for this particular reader.
6. **Inventory** — the structures currently loaded, in `organ_id — Latin (English)` form.

### The study journal

Notes, conversations and case grades are kept in a local SQLite file in the
application's data directory. Nothing about it is remote and nothing about it is
optional to the rest of the app.

It lives in **Rust**, not in the Python sidecar, although Python has `sqlite3`
built in. The sidecar is the process that holds API keys and talks to a model
provider, and it is the one killed and respawned on a crash. A student's own
notes want neither property. `rusqlite`'s `bundled` feature compiles SQLite into
the binary, so there is no system library to locate on any of the three targets.

Opening the journal cannot fail the application. A database that will not open
is remembered as unavailable and reported per call, so the atlas, the viewport
and the assistant all keep working — a locked file costs the student their
history, never their lesson. `studyStore` swallows its own write failures for
the same reason: saving runs from an engine-event handler, and a rejection
escaping there would take the answer down with it.

Conversations are filed as they happen, one row per finished turn, indexed by
the structures that were selected when the question was asked. That index is
what makes *"what have I already studied about the left ventricle?"* a lookup
rather than a search.

**The journal travels.** It is the one thing in the app that cannot be
recomputed — an answer can always be asked again, a year of somebody's own notes
cannot — so it exports to a single JSON file and imports on another machine.

JSON rather than a copy of the `.db`: a file copy cannot be merged into an
existing journal, breaks the moment two machines are on different schema
versions, and is opaque to anyone deciding whether to hand it to a class.

Import **merges, never replaces**, and is idempotent — someone will double-click
the file twice. Sessions key on their id, which was a UUID from the start; notes
key on a `uuid` added in schema v2 and backfilled with SQLite's own `randomblob`,
because a rowid is not an identity once it leaves the machine that issued it.
Conflicts resolve to the later edit, and a transcript is only replaced by a
longer one — a conversation only grows, which makes message count a better
signal than a timestamp that also moves when a case is graded.

**Rust opens the file dialog, not the webview.** A command taking a path would
hand the renderer a general write-anywhere capability, which is the thing this
design has avoided everywhere else.

**Case drills** are ordinary sessions with `kind = 'case'` and a score. The
score comes from a tool the agent can only call in drill mode — see
`engine/anatria_engine/case_tools.py` — and is validated at that boundary
(0–100, with a written justification long enough to still mean something weeks
later). It is a number rather than prose because it is the part the journal can
average and chart, and that cannot be recovered from a paragraph afterwards.

### Why nomenclature is not localised

The manifest carries Terminologia Anatomica Latin and clinical English only.
Rendering *Ventriculus sinister* for a layperson, a student and a clinician
needs three different explanations, in each of three languages — that is not a
lookup, it is teaching. A frozen translation table would serve all three
audiences the same words and leave a pile of unreviewed medical terms in the
repo. The agent does it per turn with the profile in hand.

---

## Regulatory positioning

Anatria3D is positioned as an educational tool and is built to stay outside the
scope of EU MDR 2017/745. Under Rule 11, software intended to inform diagnostic
or therapeutic decisions is a regulated medical device. Accordingly:

- The AI is instructed, in every language and every user profile, to decline
  advice about a specific person and to redirect to a healthcare professional.
- There are no patient-data fields anywhere in the application.
- Generated documents are titled *Educational Summary*, never *Clinical Report*.
- The disclaimer layer is not a preference and cannot be dismissed.
- The first-run guide opens on what the tool is *not* for, before it explains a
  single control. A reader who learns the boundary before they learn to rotate
  the model never has to unlearn anything.

The clinician profile still goes to full academic depth — pathophysiology,
differentials as study material. It just never addresses a real patient.

**Case drills are the same boundary, not an exception to it.** A drill reasons
about a patient, so it is the feature most easily mistaken for clinical use. The
instructions therefore require the assistant to state in its opening line that
the patient is invented for teaching, and to abandon the drill outright the
moment the user describes a real person — themselves, a relative, someone in
their care. `test_prompts.py` asserts that the safety block is composed into
every drill, in every profile and language, and that it precedes the case rules
rather than following them. The journal stores the student's own answers and the
grades they earned; there is no field anywhere for a real person's data.

These constraints are load-bearing. Removing them changes the product's
regulatory classification.

---

## Assets and licensing

Geometry and nomenclature come from real anatomical atlases — no placeholder or
synthesised shapes — and `public/anatomy/` holds two of them under **two
different licences**:

- `manifest.json` and `*_male.glb` are **CC BY-SA 4.0**, adapted from
  [Z-Anatomy](https://www.z-anatomy.com/), which derives from BodyParts3D
  (DBCLS, CC BY-SA 2.1 JP).
- `manifest_female.json` and `*_female.glb` are **CC BY 4.0**, from the
  [NIH Human Reference Atlas](https://humanatlas.io/), derived from the Visible
  Human Female (NLM).

Neither share-alike nor attribution extends to this application's source code,
which aggregates rather than adapts them. The two must not be merged into one
file — that would impose share-alike on material whose authors chose attribution
alone. Full attribution in [`public/anatomy/NOTICE`](public/anatomy/NOTICE) and
the file-by-file breakdown in
[`public/anatomy/LICENSE`](public/anatomy/LICENSE).

### There are two atlases, and the female one is a trunk

The Body switch above the systems list changes over between them.

| | Male | Female |
|---|---|---|
| Source | Z-Anatomy → BodyParts3D | NIH Human Reference Atlas → Visible Human Female |
| Coverage | Whole body, every system | Spine, abdomen, pelvis and breast |
| Structures | 3,478 | 264 |
| Licence | CC BY-SA 4.0 | CC BY 4.0 |

**The female atlas is not a female body, and the application says so where you
choose it.** It holds the vertebral column from C1 to the coccyx, the pelvic
girdle, the uterus with its cervix and walls, both uterine tubes down to the
fimbriae, the ovaries, the vagina, sixteen ligaments and peritoneal folds, the
bladder and ureters, both kidneys, the liver with its impressions and ligaments,
the biliary tract, the pancreas, the spleen, the small and large intestine,
sixty vessels — the pelvis, the coeliac trunk, the mesenteric tree and the whole
portal system — and the breast, which exists nowhere on the male
atlas, and is filed under the integumentary system where Terminologia Anatomica
files it.

**What it lacks, it lacks in the source:** no skull, no ribcage, no limbs, and
no skeletal muscle or peripheral nerve at all. The HRA models organs, not a
body.

Where it is *better* than the male atlas is worth saying too, because the
structure count invites the opposite assumption. Where the two overlap, the
female viscera are modelled far more finely:

| System | Male | Female |
|---|---|---|
| Renal | 8 | **58** |
| Reproductive | 14 | **36** |
| Digestive | 47 | **50** |
| Cardiovascular (abdomen and pelvis) | — | **60** |
| Integumentary (the breast) | 0 | **16** |

A kidney there opens into capsule, hilum, cortex, columns and every pyramid
with its papilla; on the male side a kidney is one mesh.

**This atlas is one woman, not an average, and the interface says so.** The
male atlas is an idealised composite; this is a 59-year-old subject, frozen and
sectioned supine. Two differences from the textbook are measurable in the
shipped geometry, and both are surfaced where the reader chooses the body and
again in the assistant's instructions — which are told to give the classical
teaching value first and describe this body second:

- **Six lumbar vertebrae**, L1 to L6, where most people have five. A real
  variant, in roughly one person in twenty.
- **The kidneys span L1 to L5**, against the vertebrae shipped beside them,
  where the classical description is T12 to L3 — and the left is 2.7 cm longer
  than the right. Cadaveric position and the loss of muscle tone account for
  much of the descent; renal ptosis is commoner in older women. The capsule was
  checked against the outer cortex to rule out perirenal fat inflating the
  measurement: they co-extend to within a millimetre.

Neither is corrected. The geometry is the published NIH data, unaltered — a
student who is not told, however, would measure the renal level here and be
marked wrong for it.

That is a real limit and it is stated rather than worked around, because the
alternative is worse: a Male/Female toggle that promises a body and delivers a
trunk reads as a failed download, and takes the credibility of everything else
on screen with it.

The two are separate atlases rather than one model with a switch, and that is
not an implementation detail. They are **two different people** — a Japanese
male MRI subject and the Visible Human Female — so no organ of one is positioned
to sit inside the other. Switching reloads the scene because it genuinely is a
different body.

#### Why Z-Anatomy alone could not do it

Z-Anatomy publishes exactly one body and
[describes it](https://github.com/Z-Anatomy/Models-of-human-anatomy) as "Human
male model". A request for a female model has been open upstream
[since December 2023](https://github.com/moueza/Z-Anatomy/issues/20) with no
reply. The `Female genital system'` collection exists in the source blend and is
empty — as is `Male genital system'`; the male organs arrive through a different
branch of the tree.

The expensive part was never the geometry. The manifest is derived from
Z-Anatomy's collection names crossed with `TA2.csv`, which is what produces
`organ_id`, the TA2 Latin, the clinical English, the system and the anatomical
hierarchy — everything the right-click menu, region isolation and the agent's
scene tools depend on. A mesh dump without that labelling would give none of it.
The HRA needed that labelling built by hand; see below.

#### It is not fixable from upstream, and here is the check

The obvious hope is that the geometry exists further up the chain — Z-Anatomy
derives from BodyParts3D, which is indexed by FMA identifiers, so a script could
map them across. That hope does not survive contact with the data.

BodyParts3D publishes the index of every organ it holds a mesh for. Both trees
together are **4,273 entries**, and they contain **no female reproductive
structure at all** — no uterus, ovary, vagina, vulva, clitoris, uterine tube,
endometrium, cervix or broad ligament. The male ones are there with their mesh
ids, which is what proves the search rather than the spelling:

```
FMA7210   BP8579   testis
FMA9600   BP8469   prostate
FMA18247  BP8793   glans penis
FMA18255  BP8142   epididymis
FMA19386  BP8531   seminal vesicle
```

Checkable in a browser:
[`isa_parts_list_e.txt`](https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/isa_parts_list_e.txt)
and
[`partof_parts_list_e.txt`](https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/partof_parts_list_e.txt).

**The trap is that FMA is an ontology, not a mesh library.** It carries a
concept id for the uterus whether or not anybody ever modelled one, so a
documentation search finds the identifiers and reports success. Z-Anatomy fell
into the same gap from the other side: its blend declares twelve female
collections — `Uterus'`, `Ovary'`, `Vagina'`, `Vulva'`, `Clitoris'`,
`Uterine tube'`, `Broad ligament of uterus`, `Uterovaginal plexus`,
`Uterine artery'`, `Ovarian artery'`, `Vaginal artery'` — and every one of them
holds zero objects. They built the taxonomy from the concepts and had nothing to
put in it.

So the limitation is not a gap in this pipeline. **BodyParts3D was built from a
male body**, and everything downstream of it inherits that.

#### What unblocked it

A different source. The test was deliberately narrow, because it is the
conjunction that matters and every near-miss passes one half of it: **a model
must carry uterus, ovaries, uterine tubes and cervix as separate named meshes,
*and* be available under CC0, CC BY or CC BY-SA** — no non-commercial clause, no
agreement to sign, no fee.

| Candidate | Has the organs | Licence | Verdict |
|---|---|---|---|
| [**Human Reference Atlas**, HuBMAP / NIH](https://humanatlas.io/3d-reference-library) | Yes — as separate named meshes, with UBERON/FMA ids | **CC BY 4.0** | **Passes.** This is what ships |
| [**Ella**, IT'IS Virtual Population](https://itis.swiss/virtual-population/) | Yes — fully segmented | Signed agreement, non-commercial, paid commercial tiers | Fails on licence |
| [**Maastricht pelvis**, AnatomyTOOL](https://anatomytool.org/) | Yes, but pelvis only | CC BY-NC-SA 4.0 | Fails on licence *and* scope |
| [**Visible Human Female**, NLM](https://www.nlm.nih.gov/research/visible/getting_data.html) | No meshes — 40 GB of cryosections | Open terms | Research source, not integrable |
| [**Denver lower extremity**](https://digitalcommons.du.edu/visiblehuman/1/) | Lower limb only, 129 GB | CC BY 4.0 | Wrong region |

The misreading to head off, because it is the common one. *"Anatria3D is given
away, so a non-commercial source is fine"* — it is not. **NC does not restrict
what you charge; it restricts what you may grant onward.** The male atlas is
published under CC BY-SA 4.0, which permits commercial use, and that permission
cannot be granted over material that withholds it. The conflict is between the
two licences, not between the licence and a price.

Worth recording from the same search: IT'IS require the face and the genitals to
be pixelated in published images of Ella. People who work with models derived
from real individuals treat re-identification as binding, and anyone reaching
for medical imaging as a shortcut — segmenting a CT and shipping the result —
inherits that obligation along with the geometry.

#### What the HRA cost to use

Its meshes were ready; its **names were not**. The HRA is built for mapping cell
types, so it labels structures with UBERON and FMA terms, and those labels are
unusable as they stand for teaching:

- **They are not unique.** 888 structures carry 508 distinct labels. Six pelvic
  meshes are labelled `compact bone tissue` and six `trabecular bone tissue` —
  the tissue, not the bone. Joining on the label would merge the ilium with the
  ischium.
- **They word structures differently from TA2.** `uterine cervix` is TA2's
  *Cervix of uterus*; `trigone of urinary bladder` is *Trigone of bladder*;
  every pelvic vessel TA2 calls *anorectal*, the HRA calls rectal. A naive match
  resolved 32 of 70.
- **A few are wrong.** One vein carries the label and ontology id of the
  corresponding artery.

So every structure was matched by hand to a TA2 term in
[`hra-selection.mjs`](tools/asset-pipeline/hra-selection.mjs), and the build
**fails** if any term is absent from `TA2.csv`. Eleven structures in the source are
deliberately not shipped — the uterine horn, a cervicovaginal junction the
source declines to label, the duodenal ampulla, an inferior pancreaticoduodenal
vein, two segmental hepatic arteries and five placental structures — because
TA2 does not list them,
and coining plausible Latin for an anatomy atlas is worse than leaving a
structure out. The reasons are recorded beside the table, and a test asserts
every shipped term exists.

Three more are left out by judgement rather than by the standard, and they are
recorded in a separate list so a decision cannot borrow the standard's
authority: TA2 names the umbilical artery and vein, but nothing else of the
placenta — not the basal or chorionic plate, not the amnion, not the cord, all
of which are Terminologia Embryologica terms. Three vessels floating where a
placenta should be would teach nothing.

One laterality was read off the geometry rather than guessed: the source ships a
single unlateralised triangular ligament of the liver where TA2 has only a right
and a left. It sits entirely at positive x, and the paired structures in this
body put the left side at positive x, so it is the left one.

Provenance for all 264 — original node name, UBERON or FMA id, source label,
polygon count — is committed in `tools/asset-pipeline/vendor/reports-female/`.
The extraction stays inside glTF rather than round-tripping through Blender, so
the node names are byte-identical to the published digital object and any
structure here can be checked against the HRA portal.

#### The rule that shaped it

**A female reproductive module is not a female model** — dropping a uterus into
a male pelvis produces wrong relations, and spatial relations are what this
application is for.

That is why nothing was dropped into anything. The female atlas ships its own
pelvic girdle, its own bladder, its own rectum and its own vessels, all from the
same body, and the male atlas is untouched. What you are looking at when you
switch is one person's pelvis, internally consistent, not a graft.

The same rule applies to the licences. CC BY material may lawfully be folded
into a CC BY-SA work, but the result must then be share-alike — imposing a
condition the HRA's authors chose not to. So the two atlases are separate files,
which keeps this a mere aggregation, and
[a test asserts they never share a mesh file](tests/female-atlas.test.ts).

### What else is missing, and what is complete

Audited against the source blend, not from memory. Everything below is absent
from Z-Anatomy itself — none of it was lost in our pipeline, and none of it can
be recovered without different source data.

**Gaps a student will notice**

- **The gut has a hole in it.** Duodenum and jejunum are here, then it jumps
  straight to the colon: no **ileum, caecum, rectum or anal canal**.
- **No meninges** — no dura, arachnoid or pia.
- **No skin.** There is no `Cutis` and no integument. What reads as a body
  surface is the 256 named *regions* in the `regional` system — "mammary
  region", "angle of mouth" — which are territories, not an organ.
- **No thoracic duct, no vocal folds.**
- **No bronchopulmonary lung segments**, although all twenty-seven segmental
  bronchi are present with their BI–BX numbering.

**Present only as their parts.** No single mesh exists for the skull, the
larynx, the lung (lobes only), the small intestine, the peritoneum, the lumbar
and sacral plexuses, or the semicircular canals. Z-Anatomy names each of these
with a zero-geometry marker — the same reason there is no mesh called "Heart" —
so the right-click ancestry menu reaches them wherever the atlas defines a
collection, and nothing does where it does not.

**Complete**, checked against a 130-structure list of what a general atlas owes:
the arterial and venous trees to the periphery, the whole musculature, the
urinary and endocrine organs, every bone individually, all twelve cranial
nerves, the lymph nodes in unusual detail, and the eight hepatic segments of
Couinaud.

### Why the pipeline drops 1,616 objects, and why that is correct

```
5,520  geometry objects in the blend
1,616  skipped: no evaluated geometry
3,904  real meshes
4,349  bucket placements (a structure can belong to two systems)
3,478  unique manifest entries
```

The 1,616 are Z-Anatomy's `.j` and `.i` objects: **named markers carrying zero
polygons**, used to place a label for a concept whose geometry lives in its
parts — `Aorta.j`, `Colon.j`, `Digestive system.j`, `Ankle joint.j`. The split
is unambiguous: `.l` and `.r` objects reach the manifest at 95%, `.j` and `.i`
at 4%. That is a category, not attrition.

One inconsistency worth knowing about: `integumentary` is a valid value in both
protocol schemas and has a colour and a label in `palette.ts`, but no structure
in the manifest uses it. The branch is dead rather than wrong — the legend
simply can never show that entry.

### Licensing

The application source code is **Apache-2.0** ([`LICENSE`](LICENSE),
[`NOTICE`](NOTICE)). Apache rather than MIT for two reasons specific to this
project: it grants patents explicitly, which matters in a field as
patent-dense as medical software and protects adopters as well as the author;
and its warranty disclaimer is a drafted section rather than a sentence, which
is worth having behind a product that positions itself outside MDR scope.

**The two licences do not merge.** Code is Apache-2.0, anatomy is CC BY-SA 4.0,
and redistributing the anatomy keeps it under CC BY-SA 4.0 regardless of what
is done with the code. [`THIRD-PARTY-NOTICES.txt`](THIRD-PARTY-NOTICES.txt) is
the reader-facing summary of both — it is what the installer shows.

### Building the installer

```bash
pnpm sidecar:build && pnpm tauri build --bundles nsis
```

Produces `src-tauri/target/release/bundle/nsis/Anatria3D_<version>_x64-setup.exe`
(~54 MB). It installs **per user**, with no administrator rights — a student on
a locked-down university laptop can run it. `pnpm sidecar:build` must come
first: the Python engine is bundled as a resource from `engine/dist/`, and a
stale build there ships a stale engine.

### Regenerating the assets

Two one-off downloads, neither committed:

| Input | Where it goes |
|---|---|
| [Z-Anatomy.zip](https://github.com/Z-Anatomy/Models-of-human-anatomy) (87 MB) — extract `Startup.blend` | `tools/asset-pipeline/vendor/Z-Anatomy/` |
| [TA2.csv](https://github.com/Z-Anatomy/Models-of-human-anatomy) (1.5 MB) | `tools/asset-pipeline/vendor/` |

Plus Blender 4.2+ (the portable zip is enough — no installer).

```bash
blender --background tools/asset-pipeline/vendor/Z-Anatomy/Startup.blend \n  --python tools/asset-pipeline/blender_export.py -- \n  --collection "Bonus collection/Cardiovascular system/Heart" \n  --out public/anatomy/cardiovascular_male.glb \n  --report tools/asset-pipeline/vendor/export-report.json

node tools/asset-pipeline/build-manifest.mjs
```

`blender_inspect.py` dumps the atlas's 1,944 collections and 4,569 objects to
JSON if you need to find another collection path.

**Install Blender at a short path.** Its glTF add-on fails to import with a
misleading `cannot import name … (unknown location)` when its own files sit
past Windows' 260-character `MAX_PATH` — the add-on looks broken when the path
is the problem.

### Why the pipeline looks the way it does

**Selection is by collection, not by object name.** Z-Anatomy's hierarchy *is*
the anatomical hierarchy; a hand-written list of object names would duplicate it
and then drift from it.

**The manifest join is automatic.** Z-Anatomy names its objects with the exact
English term from Terminologia Anatomica, which is also the `English` column of
TA2.csv — so the glTF node name pulls in Latin and Spanish with no mapping table
to maintain.

**Curves are geometry.** Z-Anatomy models the whole vascular tree — aorta, venae
cavae, coronary arteries — as bevelled *curves*, not meshes. Gathering only
`type == "MESH"` silently drops every blood vessel and leaves the heart chambers
floating alone.

**Export runs through a clean staging scene.** Exporting straight out of the
Z-Anatomy scene dies with an `IndexError` inside the glTF gatherer: that scene
carries driver networks, a dependency cycle, and elaborate material trees the
exporter has to walk. Baking each object to a plain evaluated mesh in an empty
scene removes all of it, and drops materials — which is what we want anyway,
since the viewer shades organs itself.

**Node names are sanitised on load.** three's `GLTFLoader` runs every name
through `PropertyBinding.sanitizeNodeName`, turning `Right atrium` into
`Right_atrium`. The viewer looks up both forms; a raw lookup misses every organ.

**Draco is self-hosted** in `public/draco/`, copied from `three/examples`. drei
defaults to a Google CDN, which a local-first app must not depend on and which
the CSP blocks.

### Scale, and what it costs

The full atlas ships as nine per-system `.glb` files — **2,444 structures,
5.6M polygons, 22 MB total**. Only `cardiovascular` loads at startup; the rest
download when their system is switched on, so opening the heart never pulls the
skeleton.

Two things had to change to make that survivable:

**The prompt cannot carry the atlas.** Listing every structure is ~53,000 tokens
on *every* turn — roughly $0.16 a question on a mid-tier model, and past the
context window of the cheaper ones. Above `INLINE_INVENTORY_LIMIT` (120) the
prompt switches to a per-system summary and the agent uses `find_structures` to
look up ids on demand. The frontend also sends only the *loaded* systems'
structures, not the whole manifest.

**The tree cannot render the atlas.** A system with 800+ structures freezes the
panel on mount, so systems above 60 structures start collapsed.

Roughly 5% of exported objects (126) carry names Terminologia Anatomica does not
list — parenthesised anatomical variants, plus a little scratch geometry. They
are excluded rather than shipped without nomenclature. Getting from 72% to 95%
matched came down to Z-Anatomy's dotted suffixes: `.l`/`.r` are sides, but
`.t`, `.s`, `.g`, `.st` and `.j` are its own structural markers and they stack.

Some structures genuinely belong to two systems — a tooth is both digestive and
skeletal, and Blender puts one mesh in both collections. The manifest lists such
a structure once, under the first system that claims it.

### Two constraints worth knowing

- **Z-Anatomy ships a male model only**, so everything in this section describes
  the male atlas alone. The female one comes from a different source, is built
  by a different pipeline, and is documented in
  [There are two atlases](#there-are-two-atlases-and-the-female-one-is-a-trunk).
- **TA2.csv has no Bulgarian.** It carries English, Latin, French, Spanish,
  Portuguese, Italian and Parsi. Bulgarian lives in
  `tools/asset-pipeline/translations/bg.json`, written by hand, with a per-term
  `reviewed` flag that starts false. Unreviewed labels are marked in the
  interface — machine-adjacent medical terminology must not be presented as
  authoritative. Terms with no Bulgarian at all fall back to Latin.
