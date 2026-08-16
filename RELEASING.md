# Releasing Anatria3D

Installers are published as **GitHub Releases**, attached to a tag. That is the
only official source. Anatria3D is not distributed by email, by file-sharing
link, or on request — a student who learns to accept an executable sent to them
privately has been taught the wrong habit, and this is a teaching tool.

Anyone can also build it themselves; see [Building from source](#building-from-source).

---

## Before you tag

Every gate green, on a clean tree. A release is the one moment where "it was
already failing" is not an acceptable answer.

```bash
pnpm typecheck
pnpm test

cd engine && .venv/Scripts/python -m pytest -q
cd engine && .venv/Scripts/python -m ruff check .

cd src-tauri && cargo test
cd src-tauri && cargo clippy --all-targets -- -D warnings
```

```bash
git status --short --branch   # nothing uncommitted, nothing unpushed
```

## Version numbers

### The scheme: `0.MINOR.PATCH`

Anatria3D is **before 1.0**, and the next release after `0.1.6` is **`0.1.7`** —
not `1.7.0`. The two are easy to transpose and they say opposite things: `0.1.x`
says the interfaces may still move, and `1.x` is a promise of stability to
anyone building on it. Publishing `1.0.0` is a deliberate act for the day that
promise is meant, not a typo to arrive at.

Tags are `v` plus the number: `v0.1.7`.

### The five files that carry it

They **must agree**. Tauri stamps the installer from `tauri.conf.json`, so a
mismatch ships an installer whose file name contradicts the app inside it — and
`CITATION.cff` is worse than that, because Zenodo photographs the repository at
the tag and a stale version there tells a reader to cite a build they are not
running.

| File | Field | Written by |
|---|---|---|
| `package.json` | `version` | hand |
| `src-tauri/tauri.conf.json` | `version` | hand |
| `src-tauri/Cargo.toml` | `[package] version` | hand |
| `src-tauri/Cargo.lock` | the `anatria3d` package entry | `cargo` — commit it |
| `CITATION.cff` | `version` **and** `date-released` | hand |

And in the same commit, promote `## [Unreleased]` in
[`CHANGELOG.md`](CHANGELOG.md) to `## [<version>] — <date>`. It is not one of
the five — nothing breaks if it is missed — but it is the only record of *why*
somebody should reinstall, and the moment to write it is never later.

`Cargo.lock` updates itself on the next build, but it has to go into the bump
commit or the tree is dirty at the moment of tagging. `date-released` is the
release date, not today's date if they differ.

**This is checked, not remembered.** `tools/check-version.mjs` reads all five and
fails if they disagree; it runs in Gates on every push, and in the release
workflow it is additionally handed the tag, so a `v0.1.7` pushed against files
still saying `0.1.6` fails before anything is built.

```bash
pnpm check:version          # do the five agree?
pnpm check:version 0.1.7    # do they agree, and on this number?
```

Use the second form on the bump commit. "Are they equal" and "are they the
number I meant" are different questions, and only the second catches `1.7.0`
typed where `0.1.7` was intended.

Read together rather than one at a time:

```bash
node -e "console.log('package.json      ', require('./package.json').version); console.log('tauri.conf.json   ', require('./src-tauri/tauri.conf.json').version)" && grep -m1 '^version' src-tauri/Cargo.toml && grep -A1 '^name = "anatria3d"' src-tauri/Cargo.lock | grep '^version' && grep -E '^(version|date-released)' CITATION.cff
```

## Build

```bash
pnpm sidecar:build && pnpm tauri build
```

**The sidecar first, always.** It is compiled separately and bundled as a Tauri
resource, so anything that changed under `engine/` — including prompt text,
which is the easiest to forget because it is "just words" — ships stale
otherwise.

Two installers come out, and they are not for the same reader:

| Artefact | For |
|---|---|
| `src-tauri/target/release/bundle/msi/Anatria3D_<version>_x64_en-US.msi` | **Institutions.** This is what deploys through Group Policy or Intune, across a lab, without touching each machine. |
| `src-tauri/target/release/bundle/nsis/Anatria3D_<version>_x64-setup.exe` | **Individuals.** A student installing it on their own laptop. |

Publish both.

`deb`, `appimage` and `dmg` are listed as targets but only build on their own
platform. A Windows machine produces MSI and NSIS and nothing else — do not
promise Linux or macOS builds from this box.

**The pipeline does build Linux**, on a second runner, and attaches a `.deb`
and an `.AppImage` to the same release. Two things about that job are load
bearing:

- **It runs on `ubuntu-22.04`, deliberately, not `ubuntu-latest`.** A binary
  linked against an older glibc runs on newer distributions and not the other
  way round, so building on the newest image would produce packages that refuse
  to start on Ubuntu 22.04 LTS — still the desktop in a great many faculties.
  Moving to the next LTS is a decision that drops those machines on the day it
  happens, not a version bump to make quietly.
- **Each platform writes its own checksum file.** Two assets named
  `checksums.txt` do not merge: the second upload replaces the first and takes
  the other platform's hashes with it. Hence `checksums-windows.txt` and
  `checksums-linux.txt`.

Only the Windows job writes the release `body`. If both did, whichever finished
last would overwrite the other's notes, and which one that is varies per run.

A locally built `.deb` is for testing on your own machine and nothing else.
Publishing one would put an artefact from a maintainer's laptop beside artefacts
a reader can trace to a public build — and on a rolling distribution such as
Kali it would link against a glibc almost nobody has.

## Checksums

Publish them. They are the only way anyone can prove the file they downloaded is
the file you built, and with an unsigned installer they carry the whole weight.

```powershell
certutil -hashfile Anatria3D_<version>_x64-setup.exe SHA256
certutil -hashfile Anatria3D_<version>_x64_en-US.msi SHA256
```

The pipeline computes these itself and attaches them as `checksums-windows.txt`
and `checksums-linux.txt`, so nothing has to be run by hand for a release — the
command above is for checking a file you have in front of you.

The notes are worth a paste of the Windows pair even so: a reader checking a
download should not have to open a second file first.

## Try the packages before the tag exists

The Release workflow can be started by hand, and started that way it builds
everything and **publishes nothing** — no tag, no release, just the packages
attached to the run for fourteen days.

```bash
gh workflow run release.yml --ref main
```

Download `windows-installers` and `linux-packages` from the run page and install
them. This is the only way to learn whether a package actually starts on a given
distribution, and doing it from a tag would mean the tag exists before the
answer does — and a tag is permanent, so a failure there has to be deleted from
the remote, which this project does not do.

The Linux job runs on Ubuntu and the machines it has to start on are not Ubuntu.
Test at least one of them.

## Tag and publish

**Do not upload installers by hand.** The workflow builds them, and that is the
entire point: the run is public, so a reader can trace the file they downloaded
back to this source. An artefact from a maintainer's laptop can demonstrate
nothing of the kind, and mixing the two silently gives up the guarantee.

```bash
git tag -a v<version> -m "Anatria3D v<version>"
git push origin v<version>
```

That is the whole of it. Pushing the tag starts the workflow, which runs every
gate again on the tagged commit, builds both platforms, computes the checksums,
writes the notes, and opens a **draft** release with everything attached.

Then, by hand:

1. Read the draft. Check the version in the file names is the version you tagged.
2. Install one of them.
3. **Publish.**

Publishing is the moment the release becomes real, and it is also the moment
**Zenodo wakes up** — it listens for the published event, not for the tag, and
mints the DOI from the repository as it stands at that tag. A draft is invisible
to it. This is why `CITATION.cff` has to be right *before* the tag, not before
the publish.

### What the notes must contain

The Windows job writes these from a template in the workflow. Read them rather
than assume them — if a release needs something the template does not say, edit
the draft before publishing.

- **What changed**, in the reader's terms rather than commit subjects. This is
  written in [`CHANGELOG.md`](CHANGELOG.md), not invented at tag time — paste
  that version's section into the draft. Writing it as the work lands is the
  only way it gets written honestly; reconstructed from commit subjects on the
  day, it becomes a list of what was touched rather than of what is different.
- **The checksums.** They ship as attached files, `checksums-windows.txt` and
  `checksums-linux.txt`. Pasting the two Windows hashes into the notes as well
  is worth the minute: a reader verifying a download should not have to open a
  second file first.
- **The SmartScreen paragraph** (below). Every release, not just the first —
  people arrive at whichever release they land on.
- **Which file to take**: the `.exe` for a personal machine, the `.msi` for a
  managed one.
- That it installs **without administrator rights**. On a university laptop
  where the student is not an administrator, that is the difference between
  being able to try it and not.

---

## The SmartScreen warning

Anatria3D is **not code-signed**. Windows will show *"Windows protected your
PC"* on first run, and the release notes have to say so plainly — a warning the
reader was not expecting is what makes a free tool look like a bad one.

Suggested wording, to reuse verbatim:

> Windows will warn you the first time you run the installer, because Anatria3D
> is not code-signed. Click **More info**, then **Run anyway**. If you would
> rather verify it first, the SHA-256 of each file is listed above — compare it
> with `certutil -hashfile <file> SHA256`. The source for this exact build is
> the tag this release was cut from, and you can build it yourself.

Two things that reduce the warning over time and cost nothing: SmartScreen
builds reputation from download volume, and every release from the same
publisher name adds to it. It never disappears entirely without a certificate.

**If a university's IT department blocks the installer outright**, that is not
this warning — it is a policy against unsigned executables, and no wording gets
past it. The answer there is a code-signing certificate, which is a budget
decision, not a technical one. Azure Trusted Signing is the cheapest route for a
registered entity.

---

## Building from source

Worth telling people, because it is unusually easy here: **the mesh assets are
committed**, so a source build does not need Blender or the 293 MB Z-Anatomy
file. Those are only required to *regenerate* the atlas.

```bash
pnpm install
pnpm sidecar:build
pnpm tauri build
```

Requirements are in the README.

## After publishing

There is **no auto-updater**, by design — the application never reaches the
network on its own. So nobody finds out about a new version unless they look.
Say so in the release notes, and keep the README's download link pointing at
`releases/latest` rather than a pinned version.
