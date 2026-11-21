# Experiment: symptom paths in case drills

Branch `experiment/case-paths`, from `main` at v0.7.1. Built for a presentation
at the University of Plovdiv on 2026-12-07. Not in the guide: an experiment
stays out of it until it is merged.

The owner's brief, in three phases: draw a symptom's route on the body (start,
waypoints, end) with its kind of travel, character and intensity; let a student
draw their own hypothesis and be answered Socratically against the sealed case;
and generate a case with the assistant. This notebook covers phase 1.

## Phase 1: what exists

- **The journal** (`study_db.rs`, schema v11) has a `case_path` table: kind
  (`presentation` or `hypothesis`, so phase 2 needs no second migration),
  label, spread, trigger, reflection, the points as JSON, active, timestamps.
  CASCADE with the case, like `case_symptom`. Export and import carry paths
  inside their case, and an imported path the application could not have drawn
  is skipped, not stored.
- **The wire** (`CasePath`, `CasePathPoint` on `VirtualPatient`, both sides,
  contract test extended). Only paths that are switched on, and never a
  hypothesis, are sent.
- **The prompt** (`_symptom_paths_rule`) gives each path in order, with what is
  felt at each stop, and says what each kind of travel means.
- **The viewer**: right-click a structure, "Start a symptom path here", then
  "Add as stop N" on the next ones. A panel in the viewport names and describes
  it; saved paths can be switched off and deleted. `SymptomPathsLayer` draws
  them.

## Decisions, and why

- **Stops are structures, not points on the skin.** The existing complaints are
  structures too, and a structure carries its TA2 name, which is what the
  assistant reasons with. A surface point would carry nothing.
- **The line is schematic and says so, three times.** It joins the marked
  structures' centres. The atlas has no dermatome data, and a line that bent
  along the skin as if it knew where C6 runs is the confident wrong picture
  AGENTS.md §4.4 forbids. The panel says it in words, the assistant is told it
  must never call the line a nerve, and is asked to light the real structures
  with `illuminate_structures` instead.
- **The kind of travel is drawn, not only written.** Radiating is solid with
  arrows, referred is dashed, multifocal has no line at all. The same two
  places joined solidly would claim a route that referred pain does not have.
- **Rose**, because cyan is selection, violet is a physiological route and
  amber to crimson is pathology severity.
- **Case drills only.** A path is filed on an invented patient. There is no way
  to draw one in the tutor, where it would describe the reader.
- **Closed vocabularies** (three spreads, four characters), checked in Rust,
  Pydantic and Zod, so the reader and the assistant read the same words.

## Found while building

- `cargo fmt` reformatted five files the change did not touch; the repository
  is not rustfmt-clean. Reverted, and the change re-applied without it.
- Three older migration tests wound the journal back to v6, v8 and v9 without
  dropping the v11 table, so migrating again tried to create it twice. AGENTS.md
  §4.6 says to wind the shape back, not only the stamp; the v8 test already did
  that for v10's column, and these now do it for v11's table.
- Path labels (drei `Html`) were drawn over the viewport's own panels at z-20.
  `zIndexRange` is now `[9, 0]`. Hot reload did not apply the change to a
  mounted label, which looked like the fix failing until the page was reloaded.

## Found by the owner, testing the installer

- **A student taken for the patient.** "What could cause it, I think it is
  overload" was answered by gemini-3.1-flash-lite with "since you describe
  symptoms affecting your health, I am an educational tool, not a doctor", then
  "your job as a mechanic". The real-person rule in `CASE` was worded so broadly
  that any first person fired it. It now needs an unmistakable statement, and a
  "Who is speaking" section sets the roles: the writer is a student, the patient
  is spoken of in the third person, and a drill never opens with a disclaimer.
  qwen3.5:9b, same case and message: refused 1 in 6 before, 0 in 10 after.
- **The path reached the model and was ignored.** Read back from his journal:
  the path was active and was in the prompt whole. qwen3.5:9b mentioned it in 0
  of 5 openings. Saying that paths belong to the presentation raised it to 1 of
  8; moving the section from the end of the patient (after the record and the
  complaints, just before the seal) to straight after the patient's details
  raised it to 6 of 8, and 4 of 4 when asked to start the case. Position did
  most of the work, the same lesson as the local chat's language line.
- A first attempt to measure with a path consistent with the case was thrown
  away: its words were already in the written findings, so a mention could not
  be told apart from the findings. His own path ran over the abdomen while the
  case is the left arm, which made it the clean test.

## Phase 2: the student's hypothesis

- The draft has a kind: "Patient's symptom" or "My hypothesis". A hypothesis
  needs the student's reasoning before it can be saved, has no trigger, and is
  drawn in lime with the same line styles. The panel lists the two apart.
- "Ask" on a saved hypothesis puts the student's own words in the chat
  (`feedbackAsk` on the case store), and the chat panel sends them with its
  ordinary `send`, so the turn is filed and checked like a typed one. Outside a
  case drill the request is dropped.
- `CaseHypothesis` travels beside the presentation in `VirtualPatient`, never
  inside it, and only when switched on. `_hypotheses_rule` says they are the
  student's answer and never a finding, and asks for a Socratic reply: what is
  right, each topographic error named, one question per error, the structures
  lit, no grade yet and no sealed answer.
- qwen3.5:9b with a deliberately wrong hypothesis (C5 and the axillary nerve on
  a lower-trunk case): 3 of 3 answers said what was right, asked 1 to 4
  questions, kept the seal and did not grade. All 3 also named C8, which gives
  part of the answer away; a stronger model should hold that line better, and
  it is for the owner to check on Claude.
- A probe without tools is not a probe: asked to light structures, the model
  only wrote the call as text. Stub tools fixed the measurement.

## Phase 3: drafting a case with the assistant

- "Draft with the assistant" in the new-case form: region (free text, with
  suggestions), Preclinical or Clinical correlation, BG/ES/EN. It uses the
  provider and model the chat is set to, on the reader's key, and the cost is
  filed in Usage. A draft fills every field and nothing is opened or sealed: the
  author reads it, changes it and seals it. A pre-drawn path is listed with its
  stops and drawn when the case is sealed. "Hide the answer from me" lets a
  student seal a drafted case without reading its answer.
- `case_draft.py`: structured output, a `find_structures` tool over the atlas
  the window sent, an output validator that sends invented ids back, and
  `to_draft`, which drops whatever still gets through and drops a path left
  with too few real stops. `SAFETY` comes first, as for every turn.
- The draft's events are routed to the case store by request id prefix
  (`draft-`), so a drafter's failure never surfaces as a failed chat turn.

### Measured on local models, since the owner's key is not used here

- llama3.1:8b wrote the output call as text instead of making it, and cut it
  off: not usable for this. Its draft also titled the case "Brachial Plexus
  Compression", which names the answer; the prompt now forbids a diagnosis in
  the title.
- qwen3.5:9b spent its token limit thinking until reasoning was switched off.
  Then it searched the atlas properly and found real ids, but sent the path as
  a JSON string, which failed every retry. `GeneratedCase` now reads a path sent
  as text. After that, on the real 3,478-structure atlas: brachial plexus,
  clinical, Bulgarian in 17 s; lower limb, preclinical, Spanish in 61 s. Every
  stop was a real structure.
- The content of those drafts was weak: a radicular pain called referred, and
  arteries given as the places a claudication is felt. That is the reason the
  draft fills a form instead of opening a case. Claude and GPT, which the owner
  uses, are for him to check.

## Not done yet

- The guide's section, before any merge.
- The two prompt fixes are measured on qwen3.5:9b only. Gemini and Claude,
  which the drill actually runs on, are for the owner to check with his key.
