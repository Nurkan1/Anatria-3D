# Security Policy

Anatria3D runs on a student's own machine, holds their API key in the operating
system's credential store, and spawns a sidecar process. That is a small attack
surface by design, but it is not an empty one — and a project that gives
software to universities owes the people who look at it a way to say what they
found.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** An issue is
readable by everyone the moment it is filed, including everyone running the
version that is still vulnerable.

Use GitHub's private reporting instead:

**[Report a vulnerability](https://github.com/Nurkan1/Anatria-3D/security/advisories/new)**
— under the repository's **Security** tab. It is private between you and the
maintainer, and it becomes a published advisory only once there is a fix to
publish alongside it.

Include whatever you have: the version, the platform, what you did, and what
happened. A rough report that arrives is worth more than a polished one that
does not.

### What to expect

This is a project maintained by one person, so the honest answer about timing is
"as fast as a single person can":

| | |
|---|---|
| First reply | within 7 days |
| Assessment of what it affects | within 14 days |
| Fix, or a stated reason there will not be one | as soon as one exists |

You will be credited in the advisory and the release notes unless you ask not to
be. There is no bounty — there is no money in this project at all.

## Which versions get fixes

Only the **latest release**. There is no long-term support branch, and older
versions are not patched.

This matters more here than in most projects, because **there is no auto-updater
— by design.** The application never reaches the network on its own, so it can
neither check for a new version nor install one. A fix reaches a user only when
they download and reinstall it. If you are running an older build, that is the
one you are running until you replace it deliberately.

## What is in scope

The parts where a bug would cost a user something real:

- **Credential handling** — anything that lets an API key reach the webview, the
  filesystem, a log, an exported file, or a process that should not have it. No
  Tauri command returns a key; a path that gets one out anyway is the highest
  severity finding in this repository.
- **The IPC chain** — a webview call that reaches further than its command
  should allow. Notably the file dialogs: Rust opens every one of them precisely
  so that no path crosses the boundary inward, and a way to make the renderer
  choose a path is a real finding.
- **The sidecar boundary** — the NDJSON protocol between Rust and Python, and
  anything that turns a provider's response into code execution, a file write,
  or a command.
- **The study journal** — SQL injection, or a crafted journal export that does
  something other than merge when imported.
- **The build and release path** — the GitHub Actions workflow, and anything
  that would let a published installer differ from what this repository builds.
- **Dependencies**, where the vulnerable code is actually reachable in a shipped
  build. See the note on reachability below.

## What is not

- **Anatomical or clinical inaccuracy.** Wrong anatomy is a serious bug and very
  welcome as an ordinary [issue](https://github.com/Nurkan1/Anatria-3D/issues),
  but it is not a security vulnerability and does not need a private channel.
- **What the assistant says.** It is a language model; it can be wrong, and it
  can be argued into being wrong. The application states on every screen that it
  is for education and not for diagnosis or treatment. A prompt that produces a
  bad answer is a quality report. A prompt that makes the *engine* execute
  something, read a file it should not, or leak the key is a vulnerability —
  that is the line.
- **Unsigned installers.** Windows warns on first run because the binaries are
  not code-signed. This is known, documented in the release notes, and a
  certificate costs money this project does not have. Verify with the published
  SHA-256 checksums.
- **Anything requiring an attacker who already controls the machine.** Someone
  with your user account can read your credential store whatever this app does.
- **Findings from an automated scanner, pasted without a reachable path.** See
  below.

## On dependency advisories

A CVE in a build-time dependency is not a CVE in the product. Before reporting
one, please check whether the vulnerable code is reachable in a shipped build —
`pnpm why <package> -r --prod` returning nothing means the package cannot be in
the installer at all.

Reports that name the actual path — "reachable by feeding a hostile *X* to *Y*,
which happens when a user does *Z*" — are acted on quickly. Reports that are a
scanner's output with a severity label are triaged, but slowly, and most of them
turn out to be devDependency-only.

## What this application already does not do

Some of this is useful context for anyone assessing it, and some of it is worth
knowing before spending time on a class of bug that cannot exist here:

- **It never contacts the network on its own.** No telemetry, no analytics, no
  update check, no crash reporting. The only outbound traffic is the request you
  ask the assistant to make, to the provider whose key you supplied.
- **The engine has no port.** Rust and Python speak NDJSON over stdio rather
  than HTTP on localhost, which any other process on the machine could reach.
- **The webview has no shell permission at all.** The sidecar is spawned from
  Rust with `std::process::Command`; there is no path from JavaScript to
  executing anything.
- **Notes, sessions and consumption records never leave the machine** unless you
  export them yourself, to a file you choose.

The reasoning behind each is in the Architecture section of the
[README](README.md).
