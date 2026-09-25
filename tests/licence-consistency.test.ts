import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every file that states the application's licence must state the same one.
 *
 * The move to the Business Source License in 0.5.0 left the old Apache section
 * standing at the bottom of THIRD-PARTY-NOTICES.txt — the text the installer
 * shows before anyone clicks Next — so the installer granted two licences at
 * once. Nothing failed, because nothing read it. This does.
 *
 * It also holds the one rule of the BSL that is easy to break by accident: the
 * Change Date may be no more than four years after the version is published,
 * which is a condition of using the licence's name at all.
 */

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

/** Four years, as the licence's own covenant counts them: by calendar date. */
function fourYearsAfter(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${y + 4}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

describe("the application's licence", () => {
  it("is the Business Source License in LICENSE", () => {
    expect(read("LICENSE").startsWith("Business Source License 1.1")).toBe(true);
  });

  it("is named with its SPDX id in every manifest", () => {
    expect(JSON.parse(read("package.json")).license).toBe("BUSL-1.1");
    expect(read("src-tauri/Cargo.toml")).toMatch(/^license = "BUSL-1\.1"$/m);
    expect(read("engine/pyproject.toml")).toMatch(/^license = "BUSL-1\.1"$/m);
    expect(read("CITATION.cff")).toMatch(/^license: BUSL-1\.1$/m);
    expect(JSON.parse(read("src-tauri/tauri.conf.json")).bundle.license).toBe("BUSL-1.1");
  });

  it("is never stated as Apache-2.0 for the current code", () => {
    // Apache is legitimately named as the change licence and as the licence of
    // releases up to 0.4.0. What may not survive is a sentence granting it now.
    const stale = [
      /Application source code — Apache License/,
      /the code is Apache-2\.0/i,
      /source code is released under the Apache/i,
      /source code, which is\s+Apache-2\.0/i,
    ];
    for (const file of ["THIRD-PARTY-NOTICES.txt", "NOTICE", "README.md", "public/anatomy/LICENSE"]) {
      for (const pattern of stale) expect(read(file), `${file} matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it("changes exactly four years after this version is released", () => {
    const change = /^Change Date:\s+(\d{4}-\d{2}-\d{2})$/m.exec(read("LICENSE"))?.[1];
    const released = /^date-released:\s+(\d{4}-\d{2}-\d{2})$/m.exec(read("CITATION.cff"))?.[1];
    expect(change).toBeDefined();
    expect(released).toBeDefined();
    // Not "no later than": the licence's covenant sets the ceiling, and moving
    // the date with every release is what gives each version its full four
    // years. Equality is what makes the release procedure impossible to skip.
    expect(change).toBe(fourYearsAfter(released!));
  });

  it("states the date only in LICENSE, where the release moves it", () => {
    // A change date copied anywhere else goes stale at the next release. The
    // other files state the rule instead; no date from 2030 on belongs in them.
    const future = /\b20[3-9]\d-\d\d-\d\d\b/;
    for (const file of ["NOTICE", "README.md", "THIRD-PARTY-NOTICES.txt", "tools/anatria_mcp/INSTALLED.md"]) {
      expect(read(file), file).not.toMatch(future);
    }
  });

  it("keeps the change licence it names", () => {
    expect(read("LICENSE")).toMatch(/Change License:\s+Apache License, Version 2\.0/);
    expect(read("LICENSES/Apache-2.0.txt")).toContain("Apache License");
  });
});
