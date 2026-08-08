const DAY_MS = 86_400_000;

/**
 * How long ago something was, for a journal that is scanned rather than read.
 *
 * Recent entries get an interval because that is how someone thinks about their
 * own week; anything older gets a date, because "43 days ago" is a number you
 * have to do arithmetic on. `now` is a parameter so the boundary between the
 * two is testable.
 */
export function whenLabel(epochMs: number, now = Date.now()): string {
  const days = Math.floor((now - epochMs) / DAY_MS);
  // A clock skew or a row written a moment ago can land in the future; "in -1
  // days" is worse than rounding it to now.
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(epochMs).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
