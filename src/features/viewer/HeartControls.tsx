import { useMemo, useState } from "react";

import { useHeartStore } from "@/stores/heartStore";
import { useSceneStore } from "@/stores/sceneStore";

import { beatChamber } from "./heartbeat";
import { primeHeartSound } from "./heartSound";
import { OVERLAY_SWITCH_OFF, OVERLAY_SWITCH_ON } from "./overlayChrome";
import { RHYTHM_GROUPS, RHYTHMS, rhythm } from "./rhythms";

/**
 * The heartbeat's switch, and the little it needs to say.
 *
 * It says *illustrative* on its face, not in a tooltip. What moves is the
 * atlas's static heart drawn in towards each chamber's centre in the order of
 * the cardiac cycle; a reader who took that for a model of cardiac mechanics
 * would be learning something the application never claimed.
 *
 * # The rhythms fold away
 *
 * The heart beating, with its sound or without, is the first thing and the
 * thing most people want. The rhythms are a second step with a button of their
 * own, closed at first: thirteen of them open would push the rest of the
 * viewport's controls off a laptop screen for somebody who only wanted to watch
 * a heart beat.
 *
 * And what they are is said where they are chosen: textbook patterns for study.
 * Each is one representative example; nobody's heart is read from it.
 */
export function HeartControls() {
  const enabled = useHeartStore((s) => s.enabled);
  const sound = useHeartStore((s) => s.sound);
  const rhythmId = useHeartStore((s) => s.rhythm);
  const toggle = useHeartStore((s) => s.toggle);
  const setSound = useHeartStore((s) => s.setSound);
  const setRhythm = useHeartStore((s) => s.setRhythm);
  const organs = useSceneStore((s) => s.organs);
  const cardiovascularHidden = useSceneStore((s) => s.hiddenSystems.includes("cardiovascular"));
  const [rhythmsOpen, setRhythmsOpen] = useState(false);

  // Not every body has one: the female atlas carries no cardiovascular system.
  const hasHeart = useMemo(
    () => Object.values(organs).some((organ) => beatChamber(organ) !== null),
    [organs],
  );
  const current = rhythm(rhythmId);

  return (
    <div className="pointer-events-auto flex flex-col items-start gap-1.5">
      <button
        type="button"
        disabled={!hasHeart}
        onClick={() => {
          // The click is the gesture audio needs. With the sound already ticked
          // the first beat has to be able to play.
          if (!enabled && sound) primeHeartSound();
          toggle();
        }}
        aria-pressed={enabled}
        title={
          !hasHeart
            ? "This body has no heart to animate"
            : enabled
              ? "Stop the heartbeat"
              : "Make the heart beat: the atria, then the ventricles"
        }
        className={`rounded border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
          enabled ? OVERLAY_SWITCH_ON.rose : OVERLAY_SWITCH_OFF
        }`}
      >
        Heartbeat
      </button>

      {enabled && (
        <div className="max-w-52 rounded border border-rose-900/60 bg-slate-950/80 px-2 py-1.5 text-[9px] leading-snug text-slate-400">
          <p className="uppercase tracking-wider text-rose-300/80">
            {current.rate} · illustrative
          </p>
          <p className="mt-0.5 font-medium text-slate-200">{current.label}</p>
          <p className="mt-0.5">{current.what}</p>
          {cardiovascularHidden && (
            <p className="mt-0.5 text-amber-300/80">
              Switch the cardiovascular system on to see it.
            </p>
          )}
          <label className="mt-1 flex cursor-pointer items-start gap-1.5">
            <input
              type="checkbox"
              checked={sound}
              onChange={(event) => {
                if (event.target.checked) primeHeartSound();
                setSound(event.target.checked);
              }}
              className="mt-[1px] accent-rose-500"
            />
            Heart sounds
          </label>

          <button
            type="button"
            onClick={() => setRhythmsOpen((open) => !open)}
            aria-expanded={rhythmsOpen}
            className="mt-1.5 flex w-full items-center justify-between rounded border border-slate-700 px-1.5 py-0.5 text-[9px] text-slate-300 hover:border-rose-700 hover:text-rose-200"
          >
            <span>Rhythms</span>
            <span aria-hidden>{rhythmsOpen ? "▴" : "▾"}</span>
          </button>

          {rhythmsOpen && (
            <div
              role="radiogroup"
              aria-label="Heart rhythm"
              // Scrolls inside itself rather than growing: the column it sits in
              // has the scanner above it and a laptop's height to share.
              className="mt-1 max-h-48 space-y-1 overflow-y-auto pr-0.5 short:max-h-32"
            >
              {RHYTHM_GROUPS.map((group) => (
                <div key={group}>
                  <p className="text-[8px] uppercase tracking-wider text-slate-500">{group}</p>
                  {RHYTHMS.filter((candidate) => candidate.group === group).map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      role="radio"
                      aria-checked={candidate.id === rhythmId}
                      onClick={() => setRhythm(candidate.id)}
                      className={`block w-full rounded px-1 py-0.5 text-left text-[9px] ${
                        candidate.id === rhythmId
                          ? "bg-rose-500/15 text-rose-200"
                          : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                      }`}
                    >
                      {candidate.label}
                    </button>
                  ))}
                </div>
              ))}
              <p className="pt-1 text-[8px] leading-snug text-slate-500">
                Textbook patterns for study, each at one representative rate — not a way to
                assess anyone&apos;s heart.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
