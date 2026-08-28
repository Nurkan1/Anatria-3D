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

/**
 * Prove the store works, at startup, before anything depends on it.
 *
 * A read alone is not proof: an empty store and a refused one both come back
 * `null`, which is how this went unnoticed. Writing a value and taking it away
 * again is the only check that separates them, and it costs one key on one
 * launch.
 */
export function checkStorage(): void {
  const key = "anatria3d.storage.probe";
  if (!writeLocal(key, "1")) return;
  removeLocal(key);
}
