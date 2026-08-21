import { useState } from "react";

import { type Language } from "@/lib/schemas";

import {
  speakableLanguages,
  voicesForLanguage,
  VOICE_MAX_SPEED,
  VOICE_MAX_VOLUME,
  VOICE_MIN_SPEED,
  VOICE_MIN_VOLUME,
} from "./speech";
import { useLocalVoices } from "./useLocalVoices";

/**
 * Everything about how an answer is *spoken*, in one place.
 *
 * Split out of `SettingsDrawer` because voice grew a third control and the
 * drawer had begun to read as a list of unrelated switches. The reader opening
 * settings to paste an API key should not have to scroll past speech options,
 * and the reader adjusting the voice should find its settings together rather
 * than interleaved with the model picker.
 *
 * **Collapsed by default, with the one setting that gets changed left outside
 * it.** Pace is the control people actually reach for — the English voice reads
 * at a native pace, which is fast when English is not your first language and
 * you are listening for a term you have only ever read. Hiding that behind a
 * disclosure would make the common case the buried one. Length and level go
 * inside: both are set once, if ever.
 *
 * The speech is the platform's own — see `speech.ts`. Which is why this panel
 * can also have to say that a machine has no voice at all for a language.
 */

/**
 * How much of an answer to speak.
 *
 * A setting because the right answer is the reader's patience, not ours, and
 * the two failures are not symmetric: speech that is too long can be stopped
 * with a button, speech that stops early has silently removed the end of an
 * explanation — usually the part being waited for. This began as a hard-coded
 * 700 characters and did exactly that, which is why it is a choice now.
 *
 * Expressed in characters because that is what the synthesiser is given;
 * labelled in paragraphs because that is what a reader perceives.
 */
const SPOKEN_LIMITS = [
  { id: 0, label: "Whole answer", title: "Speak all of it (recommended)" },
  { id: 700, label: "~1 para", title: "Speak roughly the first paragraph" },
  { id: 1600, label: "~2 paras", title: "Speak roughly the first two paragraphs" },
] as const;

/**
 * Named stops along the pace slider.
 *
 * A slider alone gives no answer to "what should this be?", and 0.05 steps
 * invite fiddling with a control whose effect only shows up seconds later,
 * after a resynthesis. These are the three values worth having a name for; the
 * slider stays for everything between them.
 */
const SPEED_PRESETS = [
  { value: 0.8, label: "Slower", title: "For following a second language" },
  { value: 1.0, label: "Normal", title: "The voice's natural pace" },
  { value: 1.25, label: "Faster", title: "For revising something already known" },
] as const;

/** One decimal place, and no trailing `.0` on a whole multiplier. */
function formatMultiplier(value: number): string {
  return `${Number(value.toFixed(2))}×`;
}

/** `auto` speaks English, so it is named as English rather than as a setting. */
const LANGUAGE_NAMES: Record<Language, string> = {
  auto: "English",
  en: "English",
  es: "Spanish",
  bg: "Bulgarian",
};

/**
 * Said when this computer has no voice for the reader's language.
 *
 * Without it the feature is not merely unavailable, it is **invisible**: the
 * button does not appear, nothing explains why, and the reader concludes the
 * app cannot do it.
 *
 * **Which language is missing is not predictable.** The expectation was
 * Bulgarian, since the assistant starts there and it is the least common voice;
 * the machine this was tested on had Bulgarian and Spanish and no *English*.
 * Windows installs voices from its display language and whatever packs are
 * present, so nothing about a language makes it the safe one — which is why
 * this is a runtime check per language rather than a special case for any of
 * them.
 *
 * It names where to go rather than only what is wrong, because a missing voice
 * is something the reader can fix in a minute and nothing this app can fix at
 * all. Falling back to another language's voice is not the alternative: it
 * would mispronounce every term in the atlas, which is worse than silence.
 */
function MissingVoiceNotice({ language }: { language: Language }) {
  const voices = useLocalVoices();
  const name = LANGUAGE_NAMES[language];

  // An empty list also means "voices are still being enumerated", which is why
  // this waits: announcing a missing voice and then contradicting it a moment
  // later would be worse than saying nothing.
  if (voices.length === 0) return null;
  if (voicesForLanguage(voices, language).length > 0) return null;

  // `auto` is the one case where switching language is a real answer. It means
  // the reader expressed no preference, so offering them one costs nothing —
  // where a reader who *chose* Bulgarian wants Bulgarian, and telling them to
  // settle for Spanish would be answering a question they did not ask.
  //
  // Found on a real machine: a Windows PC with Spanish and Bulgarian voices and
  // no English one. `auto` speaks English, so the app went silent on a computer
  // with two perfectly good voices installed.
  const alternatives = language === "auto" ? speakableLanguages(voices) : [];
  if (alternatives.length > 0) {
    return (
      <Notice>
        Answers are read in English when no language is chosen, and this
        computer has no English voice. It does have{" "}
        {listLanguages(alternatives)} — setting the assistant to one of those
        will let it speak.
      </Notice>
    );
  }

  const windows = typeof navigator !== "undefined" && navigator.userAgent.includes("Windows");

  return (
    <Notice>
      No {name} voice is installed on this computer, so answers cannot be read
      aloud in it.{" "}
      {windows
        ? "Windows adds them under Settings → Time & language → Speech."
        : "Your desktop's speech settings control which voices are available."}
    </Notice>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 rounded border border-slate-700/70 bg-slate-800/40 px-2 py-1 text-[10px] leading-snug text-slate-400">
      {children}
    </p>
  );
}

/** "Spanish", or "Spanish and Bulgarian". Never an Oxford comma for two. */
function listLanguages(languages: Exclude<Language, "auto">[]): string {
  const names = languages.map((language) => LANGUAGE_NAMES[language]);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

interface Props {
  language: Language;
  spokenLimit: number;
  onSpokenLimitChange: (limit: number) => void;
  spokenSpeed: number;
  onSpokenSpeedChange: (speed: number) => void;
  spokenVolume: number;
  onSpokenVolumeChange: (volume: number) => void;
}

export function VoiceSettings({
  language,
  spokenLimit,
  onSpokenLimitChange,
  spokenSpeed,
  onSpokenSpeedChange,
  spokenVolume,
  onSpokenVolumeChange,
}: Props) {
  // Not persisted, unlike the drawer's own state. This is a "show me the rest"
  // gesture within an already-open panel, not a standing preference, and
  // remembering it would reopen a wall of controls for someone who expanded it
  // once out of curiosity.
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <p className="text-[10px] uppercase tracking-wider text-slate-500">Read aloud</p>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="ml-auto text-[10px] text-slate-500 underline decoration-dotted hover:text-slate-300"
        >
          {expanded ? "Fewer options" : "More options"}
        </button>
      </div>

      <MissingVoiceNotice language={language} />

      {/* Pace: the control this panel exists for, so it stays in the open. */}
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={VOICE_MIN_SPEED}
          max={VOICE_MAX_SPEED}
          // Coarse on purpose. Each change costs a resynthesis of the next
          // answer, so a step you can feel is worth more than a step you can
          // measure.
          step={0.05}
          value={spokenSpeed}
          onChange={(event) => onSpokenSpeedChange(Number(event.target.value))}
          aria-label="Speaking speed"
          // The slider's own value is a bare number to a screen reader, which
          // is the one context where "1.2" could be anything.
          aria-valuetext={`${formatMultiplier(spokenSpeed)} speed`}
          className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-slate-700 accent-sky-500"
        />
        {/* Tabular figures: without them the row twitches sideways as the
            number changes under a dragging finger. */}
        <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-slate-300">
          {formatMultiplier(spokenSpeed)}
        </span>
      </div>

      <div className="mt-1.5 flex gap-1">
        {SPEED_PRESETS.map(({ value, label, title }) => (
          <button
            key={value}
            type="button"
            onClick={() => onSpokenSpeedChange(value)}
            title={title}
            // A preset is a shortcut to a value, not a mode of its own: it
            // reads as pressed exactly when the slider is sitting on it.
            aria-pressed={spokenSpeed === value}
            className={`flex-1 rounded border px-1.5 py-1 text-[11px] ${
              spokenSpeed === value
                ? "border-sky-500 bg-sky-500/10 text-sky-300"
                : "border-slate-700 text-slate-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="mt-1 text-[10px] leading-snug text-slate-600">
        {spokenSpeed < 1
          ? "Spoken more slowly. The voice is resynthesised at this pace, so it stays the same voice rather than a stretched recording."
          : spokenSpeed > 1
            ? "Spoken more quickly. Past about 1.5× the longer anatomical terms start to run together."
            : "The voice's natural pace. Move the slider left if an answer in English goes past too quickly."}
      </p>

      {expanded && (
        <div className="mt-3 space-y-3 rounded border border-slate-800/80 bg-slate-950/40 px-2 py-2">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Volume</p>
              <span className="ml-auto text-[10px] tabular-nums text-slate-500">
                {Math.round(spokenVolume * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={VOICE_MIN_VOLUME}
              max={VOICE_MAX_VOLUME}
              step={0.05}
              value={spokenVolume}
              onChange={(event) => onSpokenVolumeChange(Number(event.target.value))}
              aria-label="Speaking volume"
              aria-valuetext={`${Math.round(spokenVolume * 100)} percent`}
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-slate-700 accent-sky-500"
            />
            <p className="mt-1 text-[10px] leading-snug text-slate-600">
              Applied when the speech is made, on top of your system volume. It only
              goes down — the voice is already normalised to full range.
            </p>
          </div>

          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
              How much is spoken
            </p>
            <div className="flex gap-1">
              {SPOKEN_LIMITS.map(({ id, label, title }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSpokenLimitChange(id)}
                  title={title}
                  aria-pressed={spokenLimit === id}
                  className={`flex-1 rounded border px-1.5 py-1 text-[11px] ${
                    spokenLimit === id
                      ? "border-sky-500 bg-sky-500/10 text-sky-300"
                      : "border-slate-700 text-slate-400"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] leading-snug text-slate-600">
              {spokenLimit === 0
                ? "The whole answer is spoken. A long one takes a few seconds to prepare before it starts — press Stop to end it early."
                : "Only the opening is spoken, cut at the end of a sentence. The written answer is always complete."}
            </p>
          </div>

          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
              Spoken language
            </p>
            {/* Not a separate control. Two language settings that could disagree
                would produce an answer written in one language and read aloud
                in another, which is worse than either — so this reports the
                answer language rather than offering a second choice of it. */}
            <p className="text-[10px] leading-snug text-slate-600">
              {language === "auto"
                ? "Answers are spoken in whichever language they come back in. The English, Spanish and Bulgarian voices are downloaded once, the first time each is used."
                : `Answers are spoken in the answer language above (${language.toUpperCase()}). Change it there and speech follows.`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
