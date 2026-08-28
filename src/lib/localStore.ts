/**
 * Every use of `localStorage`, through one door that cannot fail silently.
 *
 * # Why this exists
 *
 * Six modules kept the reader's settings here — the assistant's provider and
 * model, which systems are on and how translucent, the panel widths, whether
 * the guide has been seen — and every one of them wrapped its access in a
 * `try`/`catch` that swallowed the error and carried on with defaults. That is
 * the right *behaviour*: losing a preference must not take the session down.
 * It was the wrong *silence*. When the store became unavailable on a real
 * machine the application behaved exactly as though the reader had never
 * chosen anything, said nothing about it, and offered no way to tell the
 * difference between "you have not set this yet" and "I cannot remember
 * anything you set".
 *
 * So the swallowing stays and the silence goes. The first failure is kept, and
 * the interface says so once, quietly, where the settings live.
 *
 * # Why the failure is remembered rather than thrown
 *
 * Because it is not recoverable and not the reader's fault. A browser that
 * refuses storage refuses it for the whole session; asking every call site to
 * handle that would spread the same `try` across the code again. One record,
 * read by one notice, is the whole design.
 */

type Listener = () => void;

let failure: string | null = null;
const listeners = new Set<Listener>();

/** What went wrong the first time, or `null` while storage is working. */
export function storageFailure(): string | null {
  return failure;
}

/** Subscribe to the moment storage is first found to be unavailable. */
export function onStorageFailure(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function note(error: unknown): void {
  // Only the first. Once storage is refused every later call fails the same
  // way, and a notice that kept rewriting itself would say no more than this.
  if (failure !== null) return;
  failure =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  // Also to the console, because the packaged application has no other channel
  // and this is exactly the line somebody debugging it needs.
  console.error("[storage] localStorage is unavailable:", error);
  for (const listener of listeners) listener();
}

/**
 * Read a key, or `null` if it is absent — or if storage cannot be reached.
 *
 * The two are deliberately the same answer to the caller. A missing preference
 * and an unreadable one both mean "use the default", and the difference is
 * reported once by the notice rather than handled a sixth time here.
 */
export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    note(error);
    return null;
  }
}

/** Write a key. Returns whether it actually landed. */
export function writeLocal(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    note(error);
    return false;
  }
}

/** Forget a key. Silent when storage is unavailable — it is already forgotten. */
export function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    note(error);
  }
}

/** A value written on every launch, read back on the next one. */
const STAMP = "anatria3d.storage.stamp";

/**
 * Prove the store accepts a write at all.
 *
 * A read alone is not proof: an empty store and a refused one both come back
 * `null`. Writing a value and taking it away again separates them, and costs
 * one key on one launch.
 */
export function checkStorage(): void {
  const key = "anatria3d.storage.probe";
  if (!writeLocal(key, "1")) return;
  removeLocal(key);
}

/**
 * Prove the store survives the application closing, which is the harder half.
 *
 * # Why the write probe above is not enough
 *
 * It was not. On a real machine the browser engine failed to open its own
 * database, fell back to an in-memory store, and said nothing: every write
 * succeeded, every read within the session returned what had just been
 * written, and none of it reached the disk. The probe passed, the notice stayed
 * quiet, and the application looked exactly like one that had never been
 * configured. The only thing that can tell that store from a working one is
 * whether anything survives a restart — which cannot be measured inside a
 * single run.
 *
 * # Why the journal is the reference
 *
 * A missing stamp means one of two things, and they are opposite: this is a
 * first launch, or nothing is being kept. Nothing inside `localStorage` can
 * distinguish them, because in both cases it is empty. The journal can: it
 * lives on disk under the application's own directory, written by Rust rather
 * than by the browser engine, so a reader with sessions or notes behind them is
 * demonstrably not on their first launch. History without a stamp is the
 * signature of a store that forgets.
 *
 * Deliberately conservative. It reports only when the journal proves the reader
 * has been here before, so a genuine first run — or a reader who has never
 * asked a question or written a note — is never told anything is wrong.
 */
export function confirmStoragePersists(hasHistory: boolean): void {
  const previous = readLocal(STAMP);
  // A missing stamp is not evidence on its own, and the first build to write
  // one proved it: every reader upgrading into this feature has no stamp by
  // definition, and every one of them was told their machine forgets. What
  // settles it is whether *anything else* the application stored is still
  // here. On a working store after an upgrade the settings are all present and
  // only the stamp is new; on a store that forgets there is nothing at all.
  if (previous === null && hasHistory && !anythingStored()) {
    note(
      new Error(
        "nothing kept by earlier launches survived — the browser engine is " +
          "storing settings in memory only",
      ),
    );
  }
  writeLocal(STAMP, String(Date.now()));
}

/** Whether any setting this application wrote is still in the store. */
function anythingStored(): boolean {
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key !== null && key !== STAMP && key.startsWith("anatria3d.")) {
        return true;
      }
    }
    return false;
  } catch (error) {
    // Unreadable is its own answer, and `note` has already been told by
    // whichever read failed first.
    note(error);
    return false;
  }
}
