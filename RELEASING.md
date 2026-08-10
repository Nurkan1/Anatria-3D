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

Three files carry the version and **they must agree** — Tauri stamps the
installer from `tauri.conf.json`, and a mismatch ships an installer whose file
name contradicts the app inside it.

| File | Field |
|---|---|
| `package.json` | `version` |
| `src-tauri/tauri.conf.json` | `version` |
| `src-tauri/Cargo.toml` | `[package] version` |

```bash
node -e "console.log(require('./package.json').version, require('./src-tauri/tauri.conf.json').version)"
grep -m1 '^version' src-tauri/Cargo.toml
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

The pipeline computes these itself and attaches them as
`checksums-windows.txt` and `checksums-linux.txt`. Paste the Windows pair into
the release notes verbatim, beside the file they belong to — a reader checking a
download should not have to open a second file first.

## Tag and publish

```bash
git tag -a v<version> -m "Anatria3D v<version>"
git push origin v<version>
```

```bash
gh release create v<version> \
  "src-tauri/target/release/bundle/nsis/Anatria3D_<version>_x64-setup.exe" \
  "src-tauri/target/release/bundle/msi/Anatria3D_<version>_x64_en-US.msi" \
  --title "Anatria3D v<version>" \
  --notes-file notes.md
```

### What the notes must contain

- **What changed**, in the reader's terms rather than commit subjects.
- **Both SHA-256 hashes**, beside their files.
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
