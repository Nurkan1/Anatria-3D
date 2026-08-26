import { useEffect } from "react";

import { UNKNOWN_BRIDGE, useBridgeStore } from "@/stores/bridgeStore";

import { useCopy } from "./useCopy";

/**
 * How often the counters are re-read while the bridge is on.
 *
 * Only the counters change without this window doing anything, and they are a
 * diagnostic rather than a live readout: two seconds is fast enough to answer
 * "is my client actually reaching it" and slow enough to be free.
 */
const POLL_MS = 2000;

/**
 * The control bridge's switch.
 *
 * # Why this is a switch and not a setting
 *
 * Everything else in this drawer is a preference: which provider, which voice,
 * which language. This one opens a door. A program running as you, on this
 * machine, can drive the viewport through it — so it is off at every launch,
 * it is never turned on by anything but a press here, and turning it off
 * invalidates the token, rather than pausing something that would resume.
 *
 * # What the reader has to be able to see
 *
 * Two things, and they are the whole design. **That it is on** — which is why
 * the header carries a pill and not only this panel. And **what to paste
 * where**, because a bridge whose pipe and token cannot be copied out is one
 * nobody can actually use, and the alternative is a reader typing 32 hex
 * characters by hand.
 */
export function BridgeSettings() {
  const status = useBridgeStore((s) => s.status) ?? UNKNOWN_BRIDGE;
  const error = useBridgeStore((s) => s.error);
  const busy = useBridgeStore((s) => s.busy);
  const refresh = useBridgeStore((s) => s.refresh);
  const turnOn = useBridgeStore((s) => s.turnOn);
  const turnOff = useBridgeStore((s) => s.turnOff);

  // Asked on open rather than inherited from the header's read at startup.
  // If that one failed, the status is still null here, and a panel that drew
  // `UNKNOWN_BRIDGE` would tell a Windows reader the feature does not exist in
  // their build — a much more convincing lie than an empty panel.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const { running } = status;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [running, refresh]);

  if (!status.supported) {
    return (
      <div>
        <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
          Control bridge
        </p>
        {/* An honest absence rather than a switch that does nothing. Whoever
            reads this on Linux should learn that the feature is missing here,
            not that they failed to configure it. */}
        <p className="text-[10px] leading-snug text-slate-600">
          Not in this build. The bridge lets another program on your computer drive
          the 3D view, and so far it is only built for Windows.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <p className="text-[10px] uppercase tracking-wider text-slate-500">
          Control bridge
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={running}
          disabled={busy}
          onClick={() => void (running ? turnOff() : turnOn())}
          className={`ml-auto rounded border px-2 py-0.5 text-[10px] disabled:opacity-40 ${
            running
              ? "border-sky-500 bg-sky-500/10 text-sky-300"
              : "border-slate-700 text-slate-400 hover:border-slate-600"
          }`}
        >
          {running ? "On" : "Off"}
        </button>
      </div>

      <p className="text-[10px] leading-snug text-slate-600">
        Lets another program on this computer send view commands to this window —
        isolate a structure, highlight a pathway, reset the view. Only your own
        account can open the connection, and only a program you have paired with
        the token below is obeyed.
      </p>

      {running && (
        <div className="mt-2 space-y-2">
          {/* Deleted by the commit that connects the viewport. Until then the
              bridge is genuinely inert, and saying so is the difference between
              a feature being unfinished and a feature being broken. */}
          <p className="rounded border border-amber-800/50 bg-amber-500/5 px-2 py-1 text-[10px] leading-snug text-amber-300/90">
            Commands are accepted and counted, and nothing reaches the 3D view yet.
            The last step is not built.
          </p>

          <CopyRow label="Pipe" value={status.pipe} />
          <CopyRow label="Token" value={status.token} />

          <p className="text-[10px] leading-snug text-slate-600">
            The token is new every time you switch this on. Turning it off makes it
            wrong, so a program you paired earlier has to be given the new one.
          </p>

          <p className="text-[10px] text-slate-500">
            {status.accepted} command{status.accepted === 1 ? "" : "s"} accepted
            {status.refused > 0 && (
              <>
                {" · "}
                <span className="text-amber-300/80">{status.refused} refused</span>
              </>
            )}
          </p>
        </div>
      )}

      {error && (
        <p className="mt-2 rounded border border-rose-800/60 bg-rose-900/20 px-2 py-1 text-[10px] leading-snug text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * One copyable value.
 *
 * Its own component so each row owns its own "copied" flash — sharing one
 * would light up the token when the reader copied the pipe, which in a panel
 * whose whole job is "paste this, not that" is worse than no feedback.
 */
function CopyRow({ label, value }: { label: string; value: string | null }) {
  const { copied, copy } = useCopy();
  if (!value) return null;

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-600">{label}</p>
      <div className="flex items-center gap-1">
        <code className="min-w-0 flex-1 truncate rounded border border-slate-800 bg-slate-950 px-1.5 py-1 text-[10px] text-slate-300">
          {value}
        </code>
        <button
          type="button"
          onClick={() => void copy(value)}
          className="rounded border border-slate-700 px-1.5 py-1 text-[10px] text-slate-400 hover:border-slate-600"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
