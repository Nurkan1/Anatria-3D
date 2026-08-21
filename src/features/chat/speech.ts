import type { Language } from "@/lib/schemas";

/**
 * Choosing a voice out of the ones the operating system already has.
 *
 * `speechSynthesis` is the whole engine here: no model is bundled, nothing is
 * downloaded, and the installer does not grow by a byte. What that buys in size
 * it costs in control — the available voices are whatever the machine happens
 * to have — so everything in this module is about failing honestly when the
 * machine has nothing suitable.
 */

/**
 * Speaking rate, as a multiplier of the voice's natural pace.
 *
 * The range is the Web Speech API's own useful span rather than its full
 * 0.1–10: below 0.5 the voice slurs and above 2 it is unintelligible, so
 * offering the rest would only let a reader break it.
 */
export const VOICE_MIN_SPEED = 0.5;
export const VOICE_MAX_SPEED = 2.0;

/** Output level, as a multiplier. Exists to go down, for shared rooms. */
export const VOICE_MIN_VOLUME = 0.1;
export const VOICE_MAX_VOLUME = 1.0;

/**
 * `auto` means the reader never chose a language, so it has no voice of its
 * own. English is the app's default written language and the one every desktop
 * is most likely to have installed.
 */
const AUTO_FALLBACK = "en";

/**
 * Voices usable for `language`, best first.
 *
 * **Only local voices are ever returned, and this is the important line in the
 * file.** A `SpeechSynthesisVoice` with `localService === false` is
 * network-backed: the browser ships the text to the vendor's servers and
 * streams audio back. That is the same objection that ruled out the platform's
 * speech *recognition* — an answer about a reader's anatomy question is not
 * something to hand to a third party — and it would quietly break the promise
 * that this app needs no internet.
 *
 * The cost is real and accepted: on a machine whose only voice for a language
 * is a cloud one, this returns nothing and the feature reports itself as
 * unavailable for that language. Silence is the correct outcome there.
 */
export function voicesForLanguage(
  voices: readonly SpeechSynthesisVoice[],
  language: Language,
): SpeechSynthesisVoice[] {
  const wanted = language === "auto" ? AUTO_FALLBACK : language;

  return voices
    .filter((voice) => voice.localService && primarySubtag(voice.lang) === wanted)
    .sort((a, b) => {
      // A voice the platform marks as default for its language is the one the
      // user already hears elsewhere on the system; matching it is less
      // surprising than picking alphabetically.
      if (a.default !== b.default) return a.default ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/** The languages the assistant writes in, and so the ones worth a voice. */
const SPEAKABLE: readonly Exclude<Language, "auto">[] = ["en", "es", "bg"];

/**
 * Which of the assistant's languages this computer can actually speak.
 *
 * Used to tell a reader on `auto` that the machine is not mute — it simply has
 * no English voice, and choosing one of these would work. Listing every
 * installed voice instead would be useless: a machine with only French and
 * German voices can speak none of the languages this app writes in.
 */
export function speakableLanguages(
  voices: readonly SpeechSynthesisVoice[],
): Exclude<Language, "auto">[] {
  return SPEAKABLE.filter((language) => voicesForLanguage(voices, language).length > 0);
}

/**
 * `en-US`, `en_US` and bare `en` all reduce to `en`.
 *
 * BCP 47 says hyphen, and Windows and WebKitGTK both honour that — but the
 * underscore form turns up often enough in voice metadata that splitting on
 * only one of them would drop real voices on some machines.
 */
function primarySubtag(tag: string): string {
  return tag.toLowerCase().split(/[-_]/)[0] ?? "";
}

/**
 * The installed voices, once the platform has actually enumerated them.
 *
 * `getVoices()` returns an **empty array** on the first call in Chromium — the
 * list is populated asynchronously and announced with `voiceschanged`. Reading
 * it once at startup is the classic way to conclude a machine has no voices at
 * all when it has thirty, so this waits for the event when the first read comes
 * back empty.
 *
 * Resolves to `[]` rather than rejecting if the event never arrives: a platform
 * with no speech support is a supported state, not an error.
 */
export function loadVoices(
  synth: SpeechSynthesis,
  timeoutMs = 2000,
): Promise<SpeechSynthesisVoice[]> {
  const immediate = synth.getVoices();
  if (immediate.length > 0) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    let settled = false;

    const finish = (voices: SpeechSynthesisVoice[]) => {
      if (settled) return;
      settled = true;
      synth.removeEventListener("voiceschanged", onChanged);
      clearTimeout(timer);
      resolve(voices);
    };

    const onChanged = () => finish(synth.getVoices());
    // WebKitGTK can be built without speech synthesis, in which case the event
    // never fires and nothing is wrong — the feature is simply absent there.
    const timer = setTimeout(() => finish(synth.getVoices()), timeoutMs);

    synth.addEventListener("voiceschanged", onChanged);
  });
}
