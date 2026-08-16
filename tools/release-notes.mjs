#!/usr/bin/env node
/**
 * The body of a GitHub release, assembled rather than remembered.
 *
 * # Why this exists
 *
 * v0.1.7 shipped with an empty body. Both build jobs called the release action
 * at once, each created a draft for the same tag, and the one that noticed the
 * collision adopted the other's release and deleted its own — taking the notes
 * with it. The workflow's comment claimed the second job "leaves whatever is
 * already there alone"; what actually happened was a race, and the loser's body
 * was the thing lost.
 *
 * That is fixed by having exactly one job publish. This file is the other half:
 * the notes it publishes are *derived*, so there is nothing to paste by hand at
 * the moment a release is being cut, which is the moment nobody is careful.
 *
 * # Where the words come from
 *
 * `CHANGELOG.md`, which is written as the work lands rather than reconstructed
 * from commit subjects on the day. Everything else here — which file to take,
 * the SmartScreen warning, provenance — is the same every release and belongs
 * in one place instead of in a template inside a YAML string.
 *
 * The checksums are read from the files the build jobs produced, so the hashes
 * in the notes and the hashes in the attachment cannot drift apart.
 *
 * # Usage
 *
 *   node tools/release-notes.mjs 0.1.7 <dir-containing-checksum-files>
 *
 * Fails loudly if the changelog has no section for the version. A release whose
 * notes do not say what changed is worse than a late release.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const version = process.argv[2]?.replace(/^v/, "");
const root = process.argv[3] ?? ".";

if (!version) {
  console.error("usage: release-notes.mjs <version> [dir-with-checksums]");
  process.exit(1);
}

// -- what changed ----------------------------------------------------------

const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");

/**
 * Sliced rather than matched.
 *
 * The regex this replaced ended in `\Z`, which is a Python anchor — JavaScript
 * reads it as a literal `Z`, so the pattern silently never matched the last
 * section in the file, which is always the one being released. Indexes cannot
 * fail that quietly, and they do not care about CRLF either.
 */
const heading = `## [${version}]`;
const start = changelog.indexOf(heading);
const afterHeading = start === -1 ? -1 : changelog.indexOf("\n", start) + 1;
const next = afterHeading === -1 ? -1 : changelog.indexOf("\n## ", afterHeading);
const section =
  afterHeading === -1
    ? undefined
    : changelog.slice(afterHeading, next === -1 ? undefined : next);

if (!section?.trim()) {
  console.error(`CHANGELOG.md has no section for ${version}.`);
  console.error("Promote `## [Unreleased]` to this version before tagging — see RELEASING.md.");
  process.exit(1);
}

// -- the checksums the build actually produced -----------------------------

/** Every `checksums-*.txt` under `root`, wherever the download action put it. */
function findChecksums(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) findChecksums(path, found);
    else if (/^checksums-.*\.txt$/.test(entry)) found.push(path);
  }
  return found;
}

const hashes = findChecksums(root)
  .map((path) => readFileSync(path, "utf8").trim())
  .filter(Boolean)
  .join("\n");

// -- the parts that are the same every time --------------------------------

const body = `Anatria3D **v${version}** — Windows and Linux, 64-bit. Installs without administrator rights.

${section.trim()}

---

## Which file to take

| File | Take this one if |
|---|---|
| \`Anatria3D_${version}_x64-setup.exe\` | Windows, on your own machine. |
| \`Anatria3D_${version}_x64_en-US.msi\` | Windows, deploying across a faculty or a lab. |
| \`Anatria3D_${version}_amd64.AppImage\` | Linux. Nothing to install — make it executable and run it. |
| \`Anatria3D_${version}_amd64.deb\` | Debian or Ubuntu, through the package manager. |

The AppImage needs FUSE 2. If it will not start and complains about
\`libfuse.so.2\`, either install \`libfuse2\` or run it with
\`--appimage-extract-and-run\`.

## Windows will warn you the first time

Anatria3D is not code-signed. Click **More info**, then **Run anyway**.

To check the download first:

\`\`\`
${hashes}
\`\`\`

\`\`\`
certutil -hashfile Anatria3D_${version}_x64-setup.exe SHA256
\`\`\`

On Linux, \`sha256sum -c checksums-linux.txt\`.

## Where this file came from

Built by GitHub Actions from this tag. The run is public, so the path from this
source to the installer you downloaded can be checked by anyone.

**There is no auto-updater**, by design: the application never reaches the
network on its own. New versions appear here and nowhere else — see
[CHANGELOG.md](https://github.com/Nurkan1/Anatria-3D/blob/main/CHANGELOG.md) for
what is different in each one.

Educational use only — not a medical device, and not for diagnosis or treatment.
`;

process.stdout.write(body);
