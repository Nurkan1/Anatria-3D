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
 * Very common words that occur in one of these languages and not the other.
 *
 * Deliberately function words: they are the most frequent things in any prose
 * and they carry no subject matter, so an answer about the pericardium scores
 * the same way as one about the femur. Anatomical terms are in neither list,
 * which is what stops shared Latin from tipping the count.
 */
const SPANISH_MARKERS = new Set([
  "de", "la", "el", "que", "los", "las", "con", "para", "una", "del",
  "es", "en", "se", "por", "su", "al", "lo", "como", "más", "pero",
  "esta", "este", "son", "hacia", "entre", "cuando",
]);

const ENGLISH_MARKERS = new Set([
  "the", "of", "and", "is", "to", "in", "that", "it", "for", "with",
  "as", "are", "was", "this", "from", "by", "an", "be", "or", "which",
  "into", "between", "when", "its",
]);

/**
 * Which of the app's languages a piece of prose is written in, or `null`.
 *
 * Only reached when the reader chose `auto`, which means the assistant replied
 * in whatever language they wrote in and no setting records which. Without this
 * the app goes silent on an answer it could read perfectly: a machine with
 * Spanish and Bulgarian voices, an answer in Spanish, and no button — because
 * `auto` nominally speaks English and English was the one voice missing. That
 * happened on a real computer.
 *
 * **This is detection, not fallback.** Reaching for another language's voice
 * because the right one is absent would mispronounce every term in the atlas
 * and is refused elsewhere in this file. Reading the text to find out what it
 * actually is, and then using *that* language's voice, is the opposite move —
 * it is right whenever it is confident, and returns `null` rather than guess.
 *
 * Cheap on purpose. A language-detection dependency for three languages, on
 * text that is always at least a paragraph, would be a large amount of code to
 * decide something a dozen function words already settle.
 */
export function detectLanguage(text: string): Exclude<Language, "auto"> | null {
  // Script first, because it is decisive rather than statistical: Bulgarian is
  // the only one of the three written in Cyrillic, so a single comparison ends
  // the question without counting anything.
  const cyrillic = (text.match(/\p{Script=Cyrillic}/gu) ?? []).length;
  const latin = (text.match(/\p{Script=Latin}/gu) ?? []).length;
  if (cyrillic > latin) return "bg";
  if (cyrillic === 0 && latin === 0) return null;

  // Three characters Spanish has and no other likely language does. These are
  // decisive on their own.
  if (/[ñ¿¡]/i.test(text)) return "es";

  const words = text.toLowerCase().match(/[\p{Letter}]+/gu) ?? [];
  let spanish = 0;
  let english = 0;
  for (const word of words) {
    if (SPANISH_MARKERS.has(word)) spanish += 1;
    else if (ENGLISH_MARKERS.has(word)) english += 1;
  }

  // Acute accents count as ordinary evidence, not as proof. They were decisive
  // once and it was wrong twice over: French and Portuguese carry them too, so
  // "cavités" declared French prose Spanish — and then removing them entirely
  // made a short Spanish sentence undetectable, because "El corazón tiene
  // cuatro cámaras" has exactly one marker word in it. Weighted like a marker,
  // they tip a real Spanish sentence and leave a French one under the floor.
  spanish += (text.match(/[áéíóú]/gi) ?? []).length;

  const winner = Math.max(spanish, english);
  if (spanish === english) return null;

  // **The evidence has to be positive, not merely larger.** German and French
  // share a handful of words with these lists — "in" and "an" with English,
  // "de" and "la" with Spanish — so an answer in neither language still scores
  // one or two and would otherwise be declared the winner by default. Real
  // prose in one of these two languages hits a marker on roughly a quarter of
  // its words; a language that only overlaps hits a twentieth.
  //
  // Below the floor the answer is "none of these", which is different from a
  // tie and is why it must not fall through to a comparison.
  if (winner < MIN_MARKER_HITS) return null;
  if (winner / words.length < MIN_MARKER_SHARE) return null;

  return spanish > english ? "es" : "en";
}

/** Two hits, so a single shared word cannot decide anything. */
const MIN_MARKER_HITS = 2;

/**
 * How much of the text must be marker words before the guess is trusted.
 *
 * Spanish and English prose sit near 0.25. German and French, which only
 * overlap these lists incidentally, sit near 0.05. 0.12 separates them with
 * room on both sides rather than being tuned to the samples.
 */
const MIN_MARKER_SHARE = 0.12;

/**
 * The language to speak `text` in, or `null` if there is no honest answer.
 *
 * An explicit choice is honoured without inspecting anything — a reader who set
 * Bulgarian gets Bulgarian or nothing.
 *
 * On `auto` it follows the text, and **`null` means silence rather than
 * English**. The assistant answers in whatever language the reader writes in,
 * including ones the interface does not offer: a German student gets German.
 * Defaulting an undetected answer to English would read that German aloud in an
 * English voice, which is the mispronunciation this whole module refuses. The
 * cost is that a very short answer — a fragment too small to call — loses its
 * button, and that is the cheaper of the two mistakes.
 */
export function effectiveLanguage(
  preference: Language,
  text: string,
): Exclude<Language, "auto"> | null {
  if (preference !== "auto") return preference;
  return detectLanguage(text);
}

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
