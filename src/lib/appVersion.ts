/**
 * The version of the application the reader is actually running.
 *
 * # Why this is visible at all
 *
 * There is no auto-updater, by design — the application never reaches the
 * network on its own. So the copy on someone's machine is whatever they last
 * installed, and nothing in the interface used to say which copy that was.
 * That costs in three places:
 *
 * - **Support.** "It does not do that" and "your build does not do that yet"
 *   are the same sentence from a user who cannot see a version number, and
 *   there is no way to tell them apart without asking for a screenshot.
 * - **Provenance.** A plate exported for a lecture or a paper is evidence.
 *   Evidence that cannot say which build drew it is worth less, and the
 *   nomenclature corrections in 0.2.0 are exactly the kind of change that makes
 *   two plates of the same structure disagree.
 * - **Trust.** A tool given to universities that will not name itself reads as
 *   unfinished, whatever the state of the code behind it.
 *
 * # Where the number comes from
 *
 * Substituted at build time from `package.json` by Vite — see the `define` in
 * `vite.config.ts` for why it is quoted rather than asked of Tauri. It is not a
 * new place to edit at release: `tools/check-version.mjs` already holds the
 * five files that carry the version to the same number, and this is the first
 * of those five, read rather than repeated.
 */
declare const __APP_VERSION__: string;

export const APP_VERSION: string = __APP_VERSION__;

/** `v0.2.0` — the form shown beside the wordmark and in an export footer. */
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
