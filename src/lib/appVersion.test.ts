import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { APP_VERSION, APP_VERSION_LABEL } from "./appVersion";
import { IMAGE_FOOTER } from "@/features/viewer/exportView";

const packageJson = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"),
) as { version: string };

/**
 * The number on screen has to be the number that was built.
 *
 * `tools/check-version.mjs` holds the five files that *declare* the version to
 * one value. This is the other half: what the interface *shows* is substituted
 * from the first of those five at build time, so it can only be wrong if the
 * substitution silently stops happening — at which point the label would read
 * `v__APP_VERSION__` or `vundefined` on every screen and every exported plate.
 * That is a thing worth failing a build over rather than discovering in a
 * screenshot from a user.
 */
describe("the version the interface shows", () => {
  it("is the one package.json declares", () => {
    expect(APP_VERSION).toBe(packageJson.version);
  });

  it("was actually substituted at build time", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(APP_VERSION).not.toMatch(/APP_VERSION|undefined/);
  });

  it("is shown with a leading v, the way a release is written", () => {
    expect(APP_VERSION_LABEL).toBe(`v${packageJson.version}`);
  });

  it("travels on every exported plate", () => {
    // An image that leaves the app is evidence, and 0.2.0 corrected sixty-one
    // Latin terms — so two plates of one structure can legitimately disagree.
    // Without the build on the image there is no way to tell which to trust.
    expect(IMAGE_FOOTER.DISCLAIMER).toContain(APP_VERSION_LABEL);
    expect(IMAGE_FOOTER.DISCLAIMER).toMatch(/educational use only/i);
  });
});
