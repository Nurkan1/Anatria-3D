import { useState } from "react";

import type { PathCharacter, PathSpread } from "@/lib/studyDb";
import { activeCase, draftProblem, useCaseStore } from "@/stores/caseStore";

/**
 * The symptom paths on the open patient: drawing one, and switching them on
 * and off.
 *
 * Stops are added from the body itself — right-click a structure, "Start a
 * symptom path here", then "Add as the next stop" on the next one — because
 * that is where the reader is looking. This panel is where the path is named
 * and described, and it is shown only while a patient is open and there is
 * something to show, so it costs a tutoring session no screen at all.
 */

const SPREADS: { value: PathSpread; label: string; title: string }[] = [
  {
    value: "radiating",
    label: "Radiating",
    title: "One symptom travelling along a nerve. Drawn solid, with arrows.",
  },
  {
    value: "referred",
    label: "Referred",
    title: "Felt here, caused somewhere else, such as cardiac pain felt in the arm. Drawn dashed.",
  },
  {
    value: "multifocal",
    label: "Multifocal",
    title: "Separate places with no route between them. No line is drawn.",
  },
];

const CHARACTERS: { value: PathCharacter; label: string }[] = [
  { value: "pressing", label: "Pressing, dull" },
  { value: "sharp", label: "Sharp, electric" },
  { value: "tingling", label: "Tingling" },
  { value: "weakness", label: "Weakness" },
];

export function SymptomPathsPanel() {
  const patient = useCaseStore(activeCase);
  const paths = useCaseStore((s) => s.paths);
  const draft = useCaseStore((s) => s.draft);

  const presentations = paths.filter((path) => path.kind === "presentation");
  if (!patient || (!draft && presentations.length === 0)) return null;

  return (
    <section
      aria-label="Symptom paths"
      className="pointer-events-auto w-72 overflow-hidden rounded-lg border border-rose-800/60 bg-slate-900/95 text-xs shadow-lg backdrop-blur"
    >
      <header className="flex items-center gap-2 border-b border-slate-800 px-3 py-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full bg-rose-400" />
        <h2 className="text-[11px] font-semibold text-slate-100">Symptom paths</h2>
        <span className="ml-auto truncate text-[10px] text-slate-500">{patient.title}</span>
      </header>
      {draft ? <DraftEditor /> : <PathList />}
    </section>
  );
}

function DraftEditor() {
  const draft = useCaseStore((s) => s.draft)!;
  const updateDraft = useCaseStore((s) => s.updateDraft);
  const updateDraftPoint = useCaseStore((s) => s.updateDraftPoint);
  const removeDraftPoint = useCaseStore((s) => s.removeDraftPoint);
  const moveDraftPoint = useCaseStore((s) => s.moveDraftPoint);
  const discardDraft = useCaseStore((s) => s.discardDraft);
  const savePath = useCaseStore((s) => s.savePath);
  const [busy, setBusy] = useState(false);

  const problem = draftProblem(draft);
  const last = draft.points.length - 1;

  async function save() {
    setBusy(true);
    await savePath();
    setBusy(false);
  }

  return (
    <div className="space-y-2 px-3 py-2">
      <input
        value={draft.label}
        onChange={(event) => updateDraft({ label: event.target.value })}
        placeholder="Name, e.g. Neck to thumb"
        maxLength={200}
        className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-rose-600"
      />

      <div role="radiogroup" aria-label="How it travels" className="flex gap-1">
        {SPREADS.map((spread) => (
          <button
            key={spread.value}
            type="button"
            role="radio"
            aria-checked={draft.spread === spread.value}
            title={spread.title}
            onClick={() => updateDraft({ spread: spread.value })}
            className={`flex-1 rounded border px-1 py-0.5 text-[10px] transition ${
              draft.spread === spread.value
                ? "border-rose-500 bg-rose-500/20 text-rose-100"
                : "border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
          >
            {spread.label}
          </button>
        ))}
      </div>

      <ol className="space-y-1">
        {draft.points.map((point, index) => (
          <li key={`${point.organ_id}-${index}`} className="rounded border border-slate-800 bg-slate-950/60 px-2 py-1">
            <div className="flex items-center gap-1.5">
              <span className="w-10 shrink-0 text-[9px] uppercase tracking-wider text-rose-300/80">
                {draft.spread === "multifocal"
                  ? `Place ${index + 1}`
                  : index === 0
                    ? "Start"
                    : index === last
                      ? "End"
                      : "Via"}
              </span>
              <span className="min-w-0 flex-1 truncate italic text-slate-200" title={point.organ_label ?? point.organ_id}>
                {point.organ_label ?? point.organ_id}
              </span>
              <StopButton label="Move earlier" disabled={index === 0} onClick={() => moveDraftPoint(index, -1)}>
                ↑
              </StopButton>
              <StopButton label="Move later" disabled={index === last} onClick={() => moveDraftPoint(index, 1)}>
                ↓
              </StopButton>
              <StopButton label="Remove this stop" onClick={() => removeDraftPoint(index)}>
                ✕
              </StopButton>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <select
                aria-label="What is felt here"
                value={point.character ?? ""}
                onChange={(event) =>
                  updateDraftPoint(index, {
                    character: (event.target.value || null) as PathCharacter | null,
                  })
                }
                className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[10px] text-slate-300"
              >
                <option value="">What is felt…</option>
                {CHARACTERS.map((character) => (
                  <option key={character.value} value={character.value}>
                    {character.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Intensity"
                value={point.intensity ?? ""}
                onChange={(event) =>
                  updateDraftPoint(index, {
                    intensity: event.target.value === "" ? null : Number(event.target.value),
                  })
                }
                className="w-16 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[10px] tabular-nums text-slate-300"
              >
                <option value="">–/10</option>
                {Array.from({ length: 11 }, (_, value) => (
                  <option key={value} value={value}>
                    {value}/10
                  </option>
                ))}
              </select>
            </div>
          </li>
        ))}
      </ol>

      <p className="text-[10px] leading-snug text-slate-500">
        Right-click a structure on the body to add the next stop.
      </p>

      <input
        value={draft.trigger}
        onChange={(event) => updateDraft({ trigger: event.target.value })}
        placeholder="Brought on by…, e.g. lifting the arm"
        maxLength={200}
        className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-rose-600"
      />

      <p className="text-[10px] leading-snug text-slate-500">
        The line joins the structures you marked. It is a schematic, not the course of a nerve or
        a dermatome.
      </p>

      {problem && <p className="text-[10px] text-amber-300/80">{problem}</p>}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || problem !== null}
          className="flex-1 rounded border border-rose-700/60 bg-rose-500/15 px-2 py-1 text-[10px] text-rose-100 transition hover:bg-rose-500/25 disabled:opacity-40"
        >
          Save path
        </button>
        <button
          type="button"
          onClick={discardDraft}
          className="rounded px-2 py-1 text-[10px] text-slate-500 transition hover:text-slate-200"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

function PathList() {
  const paths = useCaseStore((s) => s.paths);
  const setPathActive = useCaseStore((s) => s.setPathActive);
  const removePath = useCaseStore((s) => s.removePath);
  const [confirming, setConfirming] = useState<number | null>(null);

  return (
    <ul className="divide-y divide-slate-800">
      {paths
        .filter((path) => path.kind === "presentation")
        .map((path) => (
          <li key={path.id} className="flex items-center gap-2 px-3 py-1.5">
            <input
              type="checkbox"
              checked={path.active}
              onChange={(event) => void setPathActive(path.id, event.target.checked)}
              aria-label={`Show ${path.label}`}
              title="Shown on the body and told to the assistant"
              className="accent-rose-500"
            />
            <span className="min-w-0 flex-1">
              <span className={`block truncate ${path.active ? "text-slate-200" : "text-slate-500"}`}>
                {path.label}
              </span>
              <span className="block truncate text-[10px] text-slate-500">
                {spreadLabel(path.spread)} · {path.points.length}{" "}
                {path.points.length === 1 ? "place" : "stops"}
                {path.trigger ? ` · ${path.trigger}` : ""}
              </span>
            </span>
            {confirming === path.id ? (
              <button
                type="button"
                onClick={() => {
                  setConfirming(null);
                  void removePath(path.id);
                }}
                className="shrink-0 rounded border border-rose-700/60 px-1.5 py-0.5 text-[10px] text-rose-200"
              >
                Delete?
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(path.id)}
                title="Delete this path"
                className="shrink-0 text-[10px] text-slate-600 transition hover:text-rose-400"
              >
                ✕
              </button>
            )}
          </li>
        ))}
    </ul>
  );
}

function spreadLabel(spread: PathSpread): string {
  return SPREADS.find((entry) => entry.value === spread)?.label ?? spread;
}

function StopButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="shrink-0 px-0.5 text-[10px] text-slate-500 transition hover:text-slate-200 disabled:opacity-30"
    >
      {children}
    </button>
  );
}
