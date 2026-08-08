# AGENTS.md — rules for anyone working on Anatria3D

The single source of truth for every AI coding agent and every human working in
this repository. If another tool insists on its own filename, make that file a
one-line pointer here rather than a copy — duplicated rules drift, and drifted
rules are worse than none.

Read this before your first edit.

---

## 1. What this project is, and the one thing that follows from it

Anatria3D is a **local-first desktop anatomy atlas** given away to universities
and medical students. Tauri shell, React viewport, Rust core, Python sidecar for
the AI.

Everything below follows from three properties, and each of them is a promise
made to somebody:

- **It works with no internet.** The atlas, the viewer, the study journal and the
  printing all run offline. Only the assistant reaches the network.
- **It teaches, and it is not a medical device.** The safety layer in the prompts
  is what keeps it outside EU MDR 2017/745.
- **It is given away.** The code is Apache-2.0 and the anatomy is CC BY-SA 4.0.

Breaking any of the three is not a bug to be fixed later. It changes what the
product legally is.

---

## 2. Git

Once this directory is under version control, these are not negotiable.

- **Trunk-based, `main` only.** Do not create branches. Do not use
  `git worktree`.
- **Never push without the owner's explicit go-ahead**, per push. Approval for
  one push is not approval for the next.
- **Never rewrite history.** No `rebase`, no `reset --hard`, no `commit --amend`,
  no force-push. If something needs undoing, add a commit that undoes it.
- **Atomic commits, Conventional Commits, in English.**
  `<type>(<optional-scope>): <imperative subject under 72 chars>` with types
  `feat fix chore refactor docs test perf ci build style`.
- **Only Claude appends `Co-Authored-By: Claude <noreply@anthropic.com>`.** Other
  agents must not add it, and must not add a trailer of their own.
- **Respect `.gitignore`.** Never commit secrets, keys, `.env`, build output,
  `target/`, `dist/`, `build/`, `.venv/`, `node_modules/`, `*.exe` or `*.pem`.
- **Never commit commercial or strategic material** — pricing, go-to-market,
  revenue framing, partner tactics. Those belong in a gitignored `*.local.md`.
  Public engineering roadmaps are fine; commercial strategy is not. `git rm`
  does not remove a file from history, so the rule is: do not commit it once.

---

## 3. Quality gates

Run all of them before every commit. Green means green; a failing gate is not
"pre-existing" unless you can point at the commit that broke it.

`.github/workflows/gates.yml` runs the same set on a clean Windows machine for
every push. That is not a reason to skip them locally — it is the thing that
catches a gate which only passed because your laptop already had something
installed.

```bash
pnpm typecheck                                   # tsc --noEmit
pnpm test                                        # vitest run
```

```bash
cd engine && .venv/Scripts/python -m pytest -q   # POSIX: .venv/bin/python
cd engine && .venv/Scripts/python -m ruff check .
```

```bash
cd src-tauri && cargo test
cd src-tauri && cargo clippy --all-targets -- -D warnings
```

**pnpm, not npm.** There is a `pnpm-lock.yaml`; a second lockfile is a defect.

Run the gates **twice around a dependency change** — once before, once after —
so a breakage is attributable to the toolchain or to the packages, not to a
guess across both.

---

## 4. Architecture rules that must not be broken

### 4.1 The IPC protocol has two owners

`src/lib/schemas.ts` (Zod) and `engine/anatria_engine/protocol.py` (Pydantic)
describe the same wire format. **Nothing in either type system connects them.**

`tests/protocol-contract.test.ts` is the connection: it derives a normalised
surface from each side and asserts they match. If you add, remove or change a
field or a union variant, **change both sides in the same commit** and let that
test prove it.

Rust deliberately models only `request_id` and `provider` and passes the rest
through opaquely. Keep it that way — the protocol has two owners, not three.

### 4.2 Security boundaries

These exist because the webview renders model output, and model output is
untrusted:

- **No shell permission, and no shell plugin.** The sidecar is spawned from Rust
  with `std::process::Command`. The webview has no path to executing anything.
- **No command returns an API key.** Keys live in the OS keyring. The frontend
  can store one, ask whether one exists, and delete one. Rust injects the key
  into the sidecar's stdin frame. It never enters the JS context.
- **Rust opens every file dialog.** A command that accepted a path would hand the
  renderer a general "write anywhere on this disk" capability. The path comes
  back only so the UI can say where the file went.
- **The CSP forbids the webview from reaching the network** (`default-src
  'self'`). Never add a CDN, a web font, an analytics call or an auto-updater.
  Self-host anything you need — the Draco decoder in `public/draco/` is the
  precedent.
- `src-tauri/capabilities/default.json` is short on purpose. Adding a permission
  is a decision for the owner, not a convenience.

### 4.3 The safety layer is load-bearing

`SAFETY` in `engine/anatria_engine/prompts.py` is what keeps this outside MDR
scope. It is composed first, before every other layer, in every turn. Do not
weaken it, reorder it below the profile, or make it conditional. The tests in
`engine/tests/test_prompts.py` assert its presence for every profile, every
language and every mode — treat a failure there as a regulatory finding, not a
test to update.

The same applies to the compliance notice on printed pages: it repeats on
**every** page, in the reader's language plus English, and it is never
paraphrased.

### 4.4 Do not visualise what you cannot support

The viewer refuses features that would look convincing and teach something
false — density-shaded "radiology" views with no density data, perfusion
territories inferred from proximity. A confident wrong picture is worse than no
picture in a teaching tool. If a visualisation requires inference, say so in the
interface or do not ship it.

### 4.5 Licensing

- Application code: **Apache-2.0** (`LICENSE`).
- Anatomy meshes and labels: **CC BY-SA 4.0** (`public/anatomy/LICENSE`,
  attribution chain in `public/anatomy/NOTICE`).
- **The two do not merge.** Never relicense the assets, never claim exclusive
  rights over them, and never strip the attribution chain. The name "Anatria3D"
  is a trademark and is not part of the Apache grant.

---

## 5. Language

| Layer | Language |
|---|---|
| Code, identifiers, comments | English |
| Commit messages | English |
| Technical documentation | English |
| **UI copy** | **English** |
| Conversation with the owner | Spanish |

Anatomical nomenclature in `manifest.json` is **Terminologia Anatomica 2 Latin
plus clinical English, and nothing else**. Do not add localised labels: rendering
a structure for a layperson, a student and a clinician needs three different
explanations per language, which is the assistant's job at runtime, not a frozen
table in the repository.

The assistant answers in the reader's selected language — and, when the reader
writes in a language the interface does not offer, in theirs. See
`prompts._language_rule`.

---

## 6. Building

The Python sidecar is compiled separately and bundled as a Tauri resource.
**If anything under `engine/` changed, the sidecar must be rebuilt or the
installer ships the old one** — including prompt changes, which are the easiest
to forget because they are "just text".

```bash
pnpm sidecar:build && pnpm tauri build --bundles nsis
```

`pnpm tauri build` alone is correct only when no Python changed.

**Releases are built by CI, not by hand.** Pushing a `v*` tag runs
`.github/workflows/release.yml`, which re-runs the gates on that exact commit,
builds the sidecar and the installers, computes their SHA-256 and opens a draft
release. Build a local installer to test; publish only what the pipeline
produced, because a reader can check that and cannot check your laptop. See
[RELEASING.md](RELEASING.md).

Mesh assets are regenerated by the pipeline in `tools/asset-pipeline/` and are
not rebuilt as part of a normal build.

---

## 7. Performance constraints that are easy to break silently

The atlas puts ~3,500 meshes on screen and is expected to run on an 8 GB laptop.

- **`OrganMesh` is memoised, and every prop must stay a primitive or a stable
  reference.** One object or arrow function built inline in the parent switches
  the memo off for every structure at once. This has already happened once.
- Anything that changes every frame — the eye rotation, the exploded view, the
  pathway marker, the lighting rig — is **imperative**, driven from `useFrame`
  and refs. Do not route per-frame values through React state.
- Systems are lazy-loaded per mesh file. Do not load a system that is switched
  off.

---

## 8. Handing over

Leave `main` clean and green: gates passing, no stray files, no commented-out
code, no `TODO` markers standing in for unfinished work. If something is
genuinely unfinished, say so in the handover message rather than leaving a stub
that returns placeholder data — a wired-up stub is worse than an absent feature,
because someone will find it and believe it.
