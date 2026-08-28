import { beforeEach, describe, expect, it } from "vitest";

import { confirmStoragePersists, readLocal, storageFailure, writeLocal } from "./localStore";

/**
 * The check that decides whether the reader is told their machine forgets.
 *
 * It is worth testing because both of its mistakes are expensive and opposite:
 * staying quiet on a store that forgets cost a morning of looking for the bug
 * in the wrong place, and speaking up on a healthy one tells every reader who
 * upgrades that something is broken when nothing is.
 */
describe("confirmStoragePersists", () => {
  beforeEach(() => {
    localStorage.clear();
    // The module keeps the first failure for the life of the session, which is
    // right in the application and wrong across tests. Reading it here at least
    // makes an accidental carry-over visible in the assertion below.
    expect(storageFailure()).toBeNull();
  });

  it("says nothing on a first run, with no history behind it", () => {
    confirmStoragePersists(false);
    expect(storageFailure()).toBeNull();
  });

  it("says nothing when the settings are there and only the stamp is new", () => {
    // The upgrade case. Every reader arriving into this feature has no stamp,
    // and telling them their machine forgets would be false for all of them.
    writeLocal("anatria3d.view.v1", '{"hiddenSystems":[]}');

    confirmStoragePersists(true);

    expect(storageFailure()).toBeNull();
  });

  it("leaves a stamp behind for the next launch", () => {
    confirmStoragePersists(false);
    expect(readLocal("anatria3d.storage.stamp")).not.toBeNull();
  });

  it("ignores its own stamp when deciding whether anything was kept", () => {
    // A stamp from a previous launch is proof on its own, so this reaches the
    // quiet path by the first condition rather than the third — but a stamp
    // must never be mistaken for a *setting* having survived.
    writeLocal("anatria3d.storage.stamp", "1");

    confirmStoragePersists(true);

    expect(storageFailure()).toBeNull();
  });
});
