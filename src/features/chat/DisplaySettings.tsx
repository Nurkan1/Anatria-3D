import { useEffect, useState } from "react";

import { displayStatus, setStableDisplay, type DisplayStatus } from "@/lib/ipc";

/**
 * Stable display: the cure for a window that blinks black for an instant.
 *
 * Off unless asked for. It is not free — on Windows the window is then
 * composited in software — and only some monitor and driver combinations blink
 * at all, so only the people who see it should pay for it. The webview's
 * settings are fixed when the window is made, so a change applies from the
 * next launch, and the panel says so until the running window agrees with the
 * stored choice.
 */
export function DisplaySettings() {
  const [status, setStatus] = useState<DisplayStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    displayStatus()
      .then(setStatus)
      .catch((reason: unknown) => setError(`Could not read the display setting: ${String(reason)}`));
  }, []);

  if (!status?.supported) return null;

  const toggle = () => {
    setBusy(true);
    setError(null);
    setStableDisplay(!status.stableDisplay)
      .then(setStatus)
      .catch((reason: unknown) => setError(`Could not save the display setting: ${String(reason)}`))
      .finally(() => setBusy(false));
  };
  const pending = status.stableDisplay !== status.active;

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <p className="text-[10px] uppercase tracking-wider text-slate-500">Stable display</p>
        <button
          type="button"
          role="switch"
          aria-checked={status.stableDisplay}
          disabled={busy}
          onClick={toggle}
          className={`ml-auto rounded border px-2 py-0.5 text-[10px] disabled:opacity-40 ${
            status.stableDisplay
              ? "border-sky-500 bg-sky-500/10 text-sky-300"
              : "border-slate-700 text-slate-400 hover:border-slate-600"
          }`}
        >
          {status.stableDisplay ? "On" : "Off"}
        </button>
      </div>
      <p className="text-[10px] leading-snug text-slate-600">
        For a screen that blinks black for an instant now and then. Some monitor,
        graphics card and driver combinations do this; the switch draws the
        window by a slightly slower, steadier route. Leave it off unless you see
        the blink.
      </p>
      {pending && (
        <p className="mt-1 text-[10px] leading-snug text-amber-300/90">
          Takes effect the next time Anatria3D starts.
        </p>
      )}
      {error && (
        <p className="mt-2 rounded border border-rose-800/60 bg-rose-900/20 px-2 py-1 text-[10px] leading-snug text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
