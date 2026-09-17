import { rhythm, type RhythmId } from "@/features/viewer/rhythms";
import type { HeartContext, SessionMode } from "@/lib/schemas";

/**
 * Whether the assistant is told which rhythm the heart is beating in.
 *
 * # Why it is told
 *
 * A reader who picked Mobitz I and asks "what is happening here?" has already
 * said which rhythm, just not in words. Without this the assistant would have
 * to guess, or ask, while the answer is on the panel beside the heart.
 *
 * # Why it does not give way to a selection
 *
 * The scanner's position is a place, and a selected structure is a better
 * statement of place, so the scanner steps aside. A rhythm is not a place: with
 * the left ventricle selected, "why does it do that?" is about the ventricle
 * *in* that rhythm, and both are sent.
 *
 * # When it says nothing
 *
 * - The heartbeat is off. A rhythm picked and then stopped is not on screen.
 * - A drill or a review. Their subject is the patient, and a rhythm left
 *   playing in the viewport is not part of that patient's case.
 */
export interface HeartAimInput {
  enabled: boolean;
  mode: SessionMode;
  rhythm: RhythmId;
  sound: boolean;
}

export function heartAim(input: HeartAimInput): HeartContext | null {
  if (!input.enabled || input.mode !== "tutor") return null;
  const current = rhythm(input.rhythm);
  return {
    rhythm: current.label,
    rate: current.rate,
    pattern: current.what,
    sound: input.sound,
  };
}
