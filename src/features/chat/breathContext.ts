import { BREATH_PATTERNS, type BreathPatternId } from "@/features/viewer/breathing";
import { rhythm, type RhythmId } from "@/features/viewer/rhythms";
import { breathNote } from "@/features/viewer/sinusArrhythmia";
import type { BreathContext, SessionMode } from "@/lib/schemas";

/**
 * Whether the assistant is told the body is breathing, and what the breath is
 * doing to the heartbeat on screen.
 *
 * # Why it is told
 *
 * For the heartbeat's reason (`heartAim`): a reader watching the chest rise
 * who asks "what is happening?" has said what they mean, just not in words.
 * And with the heart beating too, "why does the heart rate keep changing?" is
 * a question about the breath — sinus arrhythmia — that the assistant could
 * only answer by guessing without this.
 *
 * # When it says nothing
 *
 * - Breathing is off.
 * - A drill or a review, for the heartbeat's reason: their subject is the
 *   patient, and a breath left running in the viewport is not part of the case.
 */
export interface BreathAimInput {
  enabled: boolean;
  mode: SessionMode;
  pattern: BreathPatternId;
  heartEnabled: boolean;
  rhythm: RhythmId;
}

export function breathAim(input: BreathAimInput): BreathContext | null {
  if (!input.enabled || input.mode !== "tutor") return null;
  const pattern = BREATH_PATTERNS[input.pattern];
  return {
    pattern: pattern.label,
    rate: pattern.rate,
    what: pattern.what,
    heart: input.heartEnabled ? breathNote(rhythm(input.rhythm).followsBreath ?? 0) : null,
  };
}
