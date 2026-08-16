#!/usr/bin/env node
/**
 * Do the five files that carry the version agree?
 *
 * # Why this is a gate and not a habit
 *
 * Five files name the version and they are written in four formats, by three
 * different hands — some by a person, `Cargo.lock` by cargo, and none of them
 * by each other. Nothing in the toolchain notices when one is left behind, and
 * the failures are all late and all expensive:
 *
 * - `tauri.conf.json` stamps the installer, so a mismatch there ships a file
 *   whose name contradicts the application inside it.
 * - `Cargo.lock` updates itself on the next build, which means a bump that
 *   forgot it leaves the tree dirty at the exact moment of tagging.
 * - `CITATION.cff` is read by Zenodo, which photographs the repository at the
 *   tag. A stale version there tells a reader to cite a build they are not
 *   running — worse than having no citation file at all, because it is wrong
 *   rather than absent.
 *
 * A release is also the one moment when a person is doing five near-identical
 * edits in a row, which is when a person is worst at noticing they did four.
 *
 * # Usage
 *
 *   node tools/check-version.mjs            # do they agree?
 *   node tools/check-version.mjs 0.1.7      # do they agree, and on this?
 *
 * The second form is for the bump commit: it answers "did I change them all to
 * the number I meant", which is a different question from "are they equal", and
 * the one that catches `1.7.0` typed where `0.1.7` was meant.
 */

import { readFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");

/** Each entry answers one question: what version does *this* file claim? */
const SOURCES = [
  {
    file: "package.json",
    find: (text) => JSON.parse(text).version,
  },
  {
    file: "src-tauri/tauri.conf.json",
    find: (text) => JSON.parse(text).version,
  },
  {
    file: "src-tauri/Cargo.toml",
    // The first `version` after `[package]`. Dependencies carry the key too,
    // and a bare search for it finds whichever crate happens to sort first.
    find: (text) => /\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(text)?.[1],
  },
  {
    file: "src-tauri/Cargo.lock",
    // Anchored to our own package entry, for the same reason.
    find: (text) =>
      /^name = "anatria3d"\r?\nversion = "([^"]+)"/m.exec(text)?.[1],
  },
  {
    file: "CITATION.cff",
    find: (text) => /^version:\s*(.+?)\s*$/m.exec(text)?.[1]?.replace(/^"|"$/g, ""),
  },
];

const found = SOURCES.map(({ file, find }) => {
  let version;
  try {
    version = find(read(file));
  } catch (error) {
    return { file, version: undefined, error: error.message };
  }
  return { file, version };
});

const width = Math.max(...found.map((entry) => entry.file.length));
for (const entry of found) {
  const label = entry.file.padEnd(width);
  console.log(`  ${label}  ${entry.version ?? `!! ${entry.error ?? "not found"}`}`);
}

const problems = [];

const missing = found.filter((entry) => !entry.version);
if (missing.length > 0) {
  problems.push(`could not read a version from: ${missing.map((e) => e.file).join(", ")}`);
}

const distinct = [...new Set(found.map((entry) => entry.version).filter(Boolean))];
if (distinct.length > 1) {
  problems.push(`the files disagree: ${distinct.join(" vs ")}`);
}

// A leading `v` is accepted so CI can hand this `github.ref_name` unedited.
// That is the check worth having on a tag: the five files agreeing with each
// other says nothing about whether they agree with `v0.1.7`, and a tag is the
// one thing here that cannot be taken back.
const expected = process.argv[2]?.replace(/^v/, "");
if (expected && distinct.length === 1 && distinct[0] !== expected) {
  problems.push(`the tag says ${expected}, the files say ${distinct[0]}`);
}

// Only meaningful once the versions agree; before that the date is the least of
// it. Zenodo publishes this as the release date, so a placeholder is a wrong
// fact in a permanent record rather than a missing one.
const released = /^date-released:\s*"?([^"\s]+)"?/m.exec(read("CITATION.cff"))?.[1];
if (!released || !/^\d{4}-\d{2}-\d{2}$/.test(released)) {
  problems.push(`CITATION.cff date-released is not a YYYY-MM-DD date: ${released ?? "absent"}`);
} else {
  console.log(`  ${"CITATION.cff date-released".padEnd(width)}  ${released}`);
}

if (problems.length > 0) {
  console.error("\nVersion check failed:");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("\nSee RELEASING.md — five files carry the version and they must agree.");
  process.exit(1);
}

console.log(`\nAll five agree on ${distinct[0]}.`);
